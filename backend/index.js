'use strict';

/**
 * Cloud Function (HTTP) que clasifica un correo de Gmail usando la API de Claude.
 *
 * El Add-on de Gmail envía el contenido del correo (asunto, remitente y cuerpo)
 * y esta función devuelve una categoría junto con la etiqueta de Gmail sugerida.
 *
 * Variables de entorno requeridas:
 *   - ANTHROPIC_API_KEY : clave de la API de Claude (la lee el SDK automáticamente).
 *   - ADDON_SHARED_SECRET : secreto compartido con el Add-on para autenticar peticiones.
 */

const Anthropic = require('@anthropic-ai/sdk');
const functions = require('@google-cloud/functions-framework');

// El SDK toma ANTHROPIC_API_KEY del entorno. No incrustes la clave en el código.
const client = new Anthropic();

const MODEL = 'claude-haiku-4-5';

/**
 * Taxonomía de categorías. `label` es el nombre exacto de la etiqueta que el
 * Add-on creará/aplicará en Gmail. Mantén esta lista sincronizada con
 * addon/Config.gs si quieres mostrar descripciones en la UI.
 */
const CATEGORIES = [
  { id: 'spam', label: 'Spam', description: 'Correo no deseado, phishing, estafas o mensajes masivos sospechosos.' },
  { id: 'promociones', label: 'Promociones', description: 'Ofertas, descuentos, newsletters de marcas (ropa, tiendas, ecommerce) y publicidad.' },
  { id: 'noticias', label: 'Noticias', description: 'Periódicos, boletines informativos, blogs y suscripciones de noticias.' },
  { id: 'confirmaciones', label: 'Confirmaciones', description: 'Confirmaciones de pedidos, reservas, registros, códigos de verificación y recibos.' },
  { id: 'finanzas', label: 'Finanzas', description: 'Bancos, facturas, estados de cuenta, pagos e impuestos.' },
  { id: 'trabajo', label: 'Trabajo', description: 'Correo profesional, proyectos, reuniones y comunicación laboral.' },
  { id: 'personal', label: 'Personal', description: 'Mensajes de personas conocidas, amigos y familia.' },
  { id: 'redes_sociales', label: 'Redes Sociales', description: 'Notificaciones de redes sociales y plataformas de comunidad.' },
  { id: 'viajes', label: 'Viajes', description: 'Vuelos, hoteles, reservas de viaje, tarjetas de embarque y alquiler de coches.' },
  { id: 'envios', label: 'Envíos', description: 'Seguimiento de paquetes y avisos de paqueterías (en camino, en reparto, entregado).' },
  { id: 'eventos', label: 'Eventos', description: 'Invitaciones de calendario, entradas a eventos, webinars y citas agendadas.' },
  { id: 'educacion', label: 'Educación', description: 'Cursos, plataformas de aprendizaje, universidad y material educativo.' },
  { id: 'salud', label: 'Salud', description: 'Citas médicas, farmacia, resultados de análisis y seguros de salud.' },
  { id: 'suscripciones', label: 'Suscripciones', description: 'Renovaciones y avisos de servicios recurrentes (streaming, software, membresías).' },
  { id: 'empleo', label: 'Empleo', description: 'Ofertas de empleo, procesos de selección y plataformas de reclutamiento.' },
  { id: 'otros', label: 'Otros', description: 'Cualquier correo que no encaje claramente en las categorías anteriores.' },
];

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Prompt de sistema estable: las definiciones no cambian entre peticiones, así
// que es el prefijo ideal para el cacheo de prompts (cache_control más abajo).
const SYSTEM_PROMPT = [
  'Eres un clasificador experto de correos electrónicos. Tu tarea es asignar cada',
  'correo a UNA sola categoría de la siguiente taxonomía. Analiza el remitente, el',
  'asunto y el cuerpo. Sé preciso y conservador: si dudas entre dos categorías,',
  'elige la más específica que aplique; si no encaja en ninguna, usa "otros".',
  '',
  'Categorías disponibles:',
  ...CATEGORIES.map((c) => `- ${c.id}: ${c.description}`),
  '',
  'Devuelve únicamente la categoría, un nivel de confianza (0 a 1) y una',
  'justificación breve (máximo una frase, en español).',
].join('\n');

// Esquema de salida estructurada: garantiza una respuesta JSON válida y parseable.
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: CATEGORY_IDS,
      description: 'Identificador de la categoría asignada.',
    },
    confidence: {
      type: 'number',
      description: 'Confianza de la clasificación, entre 0 y 1.',
    },
    reasoning: {
      type: 'string',
      description: 'Justificación breve en español (una frase).',
    },
  },
  required: ['category', 'confidence', 'reasoning'],
  additionalProperties: false,
};

/**
 * Construye el texto del correo para enviar al modelo, recortando el cuerpo para
 * controlar el coste de tokens. No truncamos de forma silenciosa información
 * crítica: asunto y remitente siempre van completos.
 */
function buildEmailText({ subject, from, body }) {
  const MAX_BODY_CHARS = 6000;
  let text = `De: ${from || '(desconocido)'}\nAsunto: ${subject || '(sin asunto)'}\n\nCuerpo:\n`;
  const cleanBody = (body || '').trim();
  if (cleanBody.length > MAX_BODY_CHARS) {
    text += cleanBody.slice(0, MAX_BODY_CHARS) + '\n\n[...cuerpo recortado...]';
  } else {
    text += cleanBody || '(sin contenido)';
  }
  return text;
}

/** Verifica el secreto compartido entre el Add-on y esta función. */
function isAuthorized(req) {
  const expected = process.env.ADDON_SHARED_SECRET;
  if (!expected) {
    console.error('ADDON_SHARED_SECRET no está configurado en el entorno.');
    return false;
  }
  const provided = req.get('X-Addon-Secret');
  return typeof provided === 'string' && provided === expected;
}

functions.http('classifyEmail', async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const { subject, from, body } = req.body || {};
  if (!subject && !from && !body) {
    return res.status(400).json({ error: 'Faltan datos del correo (subject, from o body).' });
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Clasificación interactiva: priorizamos latencia, sin extended thinking.
      thinking: { type: 'disabled' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Cachea el prefijo estable. Solo surte efecto si el prompt supera el
          // mínimo cacheable del modelo; es inofensivo en cualquier caso.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: buildEmailText({ subject, from, body }) },
      ],
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'El modelo rechazó clasificar este contenido.' });
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'Respuesta del modelo sin contenido de texto.' });
    }

    const parsed = JSON.parse(textBlock.text);
    const category = CATEGORY_BY_ID[parsed.category] || CATEGORY_BY_ID.otros;

    return res.status(200).json({
      categoryId: category.id,
      label: category.label,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Límite de peticiones alcanzado. Intenta más tarde.' });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Clave de Claude inválida o ausente.');
      return res.status(500).json({ error: 'Error de configuración del servidor.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Error de la API de Claude (${err.status}):`, err.message);
      return res.status(502).json({ error: 'Error al contactar con el modelo.' });
    }
    console.error('Error inesperado:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Exporta utilidades para pruebas unitarias.
module.exports = { CATEGORIES, buildEmailText, SYSTEM_PROMPT, OUTPUT_SCHEMA };
