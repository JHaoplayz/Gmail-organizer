/**
 * Clasificador por reglas (heurístico) — 100% gratis, sin API ni suscripción.
 *
 * Asigna una categoría buscando patrones en el remitente, el asunto y el cuerpo:
 *   - senderPatterns: expresiones regulares sobre la dirección del remitente.
 *   - keywords: palabras/expresiones que aparecen en asunto + cuerpo.
 *
 * Cada coincidencia suma puntos (el remitente pesa más). Gana la categoría con
 * mayor puntuación; si nadie puntúa, se asigna "otros".
 *
 * Devuelve el mismo formato que el backend de Claude:
 *   { categoryId, label, confidence, reasoning }
 * para que la Ut del Add-on funcione igual con ambos métodos.
 */

var RULES = [
  {
    id: 'spam',
    label: 'Claude/Spam',
    senderPatterns: [/no-?reply.*lottery/i, /winner/i, /prize/i],
    keywords: [
      'has ganado', 'ganaste', 'premio', 'lotería', 'loteria', 'herencia',
      'príncipe', 'principe', 'bitcoin gratis', 'reclama tu', 'click aquí urgente',
      'verifica tu cuenta inmediatamente', 'suspendida tu cuenta', 'free money',
      'you won', 'claim your prize', 'viagra', 'casino',
    ],
  },
  {
    id: 'promociones',
    label: 'Claude/Promociones',
    senderPatterns: [
      /newsletter/i, /noreply@.*(shop|store|tienda|moda|fashion)/i,
      /(zara|hm|shein|nike|adidas|bershka|pullbear|amazon|aliexpress|mercadolibre)/i,
    ],
    keywords: [
      'descuento', 'rebajas', 'oferta', 'ofertas', '% off', 'promoción', 'promocion',
      'cupón', 'cupon', 'black friday', 'cyber monday', 'envío gratis', 'envio gratis',
      'nueva colección', 'nueva coleccion', 'solo hoy', 'última oportunidad',
      'ultima oportunidad', 'sale', 's25%', '50%', 'compra ahora', 'shop now',
    ],
  },
  {
    id: 'noticias',
    label: 'Claude/Noticias',
    senderPatterns: [
      /(news|noticias|periodico|periódico|diario|times|post|herald|elpais|elmundo|bbc|cnn|reuters)/i,
      /newsletter@/i,
    ],
    keywords: [
      'boletín', 'boletin', 'newsletter', 'edición de hoy', 'edicion de hoy',
      'titulares', 'lo más leído', 'lo mas leido', 'resumen diario', 'breaking news',
      'última hora', 'ultima hora',
    ],
  },
  {
    id: 'confirmaciones',
    label: 'Claude/Confirmaciones',
    senderPatterns: [/no-?reply/i, /confirm/i, /pedidos?@/i, /orders?@/i, /booking/i],
    keywords: [
      'tu pedido', 'confirmación de pedido', 'confirmacion de pedido', 'order confirmation',
      'tu reserva', 'confirmación de reserva', 'confirmacion de reserva', 'has reservado',
      'código de verificación', 'codigo de verificacion', 'verification code',
      'tu código', 'tu codigo', 'recibo', 'comprobante', 'número de seguimiento',
      'numero de seguimiento', 'tracking', 'ha sido enviado', 'tu compra',
      'registro completado', 'cuenta creada', 'restablecer contraseña',
      'restablecer contrasena', 'reset your password',
    ],
  },
  {
    id: 'finanzas',
    label: 'Claude/Finanzas',
    senderPatterns: [
      /(bank|banco|bbva|santander|caixa|paypal|stripe|visa|mastercard|hacienda|sat)/i,
    ],
    keywords: [
      'factura', 'estado de cuenta', 'movimiento', 'cargo', 'pago recibido',
      'pago pendiente', 'transferencia', 'saldo', 'impuesto', 'declaración',
      'declaracion', 'invoice', 'payment', 'statement',
    ],
  },
  {
    id: 'redes_sociales',
    label: 'Claude/Redes Sociales',
    senderPatterns: [
      /(facebook|instagram|twitter|x\.com|linkedin|tiktok|youtube|reddit|discord|pinterest)/i,
    ],
    keywords: [
      'te ha mencionado', 'nueva solicitud', 'comentó tu', 'comento tu', 'le gustó tu',
      'le gusto tu', 'tienes una notificación', 'tienes una notificacion',
      'new follower', 'tagged you', 'sent you a', 'connection request',
    ],
  },
  {
    id: 'trabajo',
    label: 'Claude/Trabajo',
    senderPatterns: [/(jira|asana|slack|notion|trello|workspace|teams)/i],
    keywords: [
      'reunión', 'reunion', 'meeting', 'proyecto', 'informe', 'reporte', 'deadline',
      'entrega', 'agenda', 'minuta', 'calendario', 'invitación a reunión',
      'invitacion a reunion', 'tarea asignada',
    ],
  },
];

/**
 * Clasifica un correo con las reglas.
 * @param {{subject:string, from:string, body:string}} content
 * @return {{categoryId:string, label:string, confidence:number, reasoning:string}}
 */
function classifyWithRulesEngine(content) {
  var from = (content.from || '').toLowerCase();
  var haystack = ((content.subject || '') + ' ' + (content.body || '')).toLowerCase();

  var best = null;
  var bestScore = 0;
  var bestHits = [];

  for (var i = 0; i < RULES.length; i++) {
    var rule = RULES[i];
    var score = 0;
    var hits = [];

    // El remitente pesa más (3 puntos por coincidencia).
    for (var s = 0; s < rule.senderPatterns.length; s++) {
      if (rule.senderPatterns[s].test(from)) {
        score += 3;
        hits.push('remitente');
        break; // una coincidencia de remitente es suficiente
      }
    }

    // Palabras clave (1 punto cada una).
    for (var k = 0; k < rule.keywords.length; k++) {
      if (haystack.indexOf(rule.keywords[k]) !== -1) {
        score += 1;
        hits.push('"' + rule.keywords[k] + '"');
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = rule;
      bestHits = hits;
    }
  }

  if (!best || bestScore === 0) {
    return {
      categoryId: 'otros',
      label: 'Claude/Otros',
      confidence: 0.3,
      reasoning: 'No se encontraron patrones reconocibles.',
    };
  }

  // Confianza aproximada: crece con el número de coincidencias, tope 0.95.
  var confidence = Math.min(0.95, 0.5 + bestScore * 0.1);

  return {
    categoryId: best.id,
    label: best.label,
    confidence: confidence,
    reasoning: 'Coincidencias: ' + bestHits.slice(0, 4).join(', ') + '.',
  };
}
