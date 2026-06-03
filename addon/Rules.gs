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
    // OJO: no usamos /no-?reply/ porque casi todo correo automático lo lleva y
    // ensuciaría esta categoría. Solo remitentes específicos de pedidos.
    senderPatterns: [/pedidos?@/i, /orders?@/i, /receipts?@/i, /facturacion@/i],
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
      /(robinhood|coinbase|binance|kraken|etrade|fidelity|schwab|revolut|wise|n26|wealthsimple)/i,
    ],
    keywords: [
      'factura', 'estado de cuenta', 'movimiento', 'cargo', 'pago recibido',
      'pago pendiente', 'transferencia', 'saldo', 'impuesto', 'declaración',
      'declaracion', 'invoice', 'payment', 'statement', 'tu cartera', 'portfolio',
      'acciones', 'dividendo', 'rendimiento', 'inversión', 'inversion', 'account statement',
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
  {
    id: 'viajes',
    label: 'Claude/Viajes',
    senderPatterns: [
      /(booking|despegar|expedia|airbnb|kayak|skyscanner|iberia|vueling|ryanair|latam|aeromexico|avianca|trivago|hotels?\.com|renfe|trip\.com)/i,
    ],
    keywords: [
      'tarjeta de embarque', 'boarding pass', 'tu vuelo', 'reserva de hotel', 'check-in',
      'itinerario', 'confirmación de vuelo', 'confirmacion de vuelo', 'localizador',
      'alquiler de coche', 'tu reserva de viaje', 'vuelo de ida', 'vuelo de vuelta',
    ],
  },
  {
    id: 'envios',
    label: 'Claude/Envíos',
    senderPatterns: [/(dhl|fedex|ups|correos|seur|estafeta|mrw|usps|paquet|glovo|amazon\.logistics)/i],
    keywords: [
      'tu paquete', 'en camino', 'en reparto', 'ha sido entregado', 'número de seguimiento',
      'numero de seguimiento', 'tracking', 'salió a reparto', 'salio a reparto',
      'out for delivery', 'shipment', 'tu envío', 'tu envio', 'paquetería', 'paqueteria',
    ],
  },
  {
    id: 'eventos',
    label: 'Claude/Eventos',
    senderPatterns: [/(calendar|eventbrite|meetup|webinar|zoom\.us)/i],
    keywords: [
      'te ha invitado', 'invitación a', 'invitacion a', 'webinar', 'entradas para',
      'tickets para', 'rsvp', 'se ha programado', 'añadir al calendario', 'anadir al calendario',
      'recordatorio del evento', 'confirma tu asistencia',
    ],
  },
  {
    id: 'educacion',
    label: 'Claude/Educación',
    senderPatterns: [
      /(coursera|udemy|edx|platzi|domestika|khanacademy|duolingo|datacamp|codecademy|pluralsight|freecodecamp|kaggle|university|universidad|campus|moodle|classroom)/i,
    ],
    keywords: [
      'curso', 'lección', 'leccion', 'matrícula', 'matricula', 'inscripción', 'inscripcion',
      'examen', 'calificación', 'calificacion', 'certificado', 'diploma', 'aprendizaje',
      'tu progreso del curso', 'nueva clase',
    ],
  },
  {
    id: 'salud',
    label: 'Claude/Salud',
    senderPatterns: [/(clinic|clínica|clinica|hospital|farmacia|pharmacy|doctoralia|sanitas|adeslas|laboratorio)/i],
    keywords: [
      'cita médica', 'cita medica', 'resultados de', 'análisis', 'analisis', 'receta',
      'consulta', 'seguro médico', 'seguro medico', 'vacuna', 'recordatorio de cita',
      'tu salud', 'historial clínico', 'historial clinico',
    ],
  },
  {
    id: 'suscripciones',
    label: 'Claude/Suscripciones',
    senderPatterns: [
      /(netflix|spotify|disney|hbo|max|primevideo|apple|icloud|adobe|microsoft|dropbox|notion|patreon)/i,
    ],
    keywords: [
      'renovación', 'renovacion', 'tu suscripción', 'tu suscripcion', 'se renovará',
      'se renovara', 'membresía', 'membresia', 'plan mensual', 'plan anual',
      'facturación recurrente', 'facturacion recurrente', 'cancelar suscripción',
      'cancelar suscripcion', 'subscription', 'tu plan',
    ],
  },
  {
    id: 'empleo',
    label: 'Claude/Empleo',
    senderPatterns: [
      /(linkedin|indeed|glassdoor|infojobs|jobs|talent|recruiting|workday|greenhouse|lever)/i,
    ],
    keywords: [
      'oferta de empleo', 'vacante', 'puesto', 'postulación', 'postulacion', 'tu candidatura',
      'entrevista', 'reclutador', 'job opportunity', 'we are hiring', 'proceso de selección',
      'proceso de seleccion', 'ofertas que coinciden',
    ],
  },
];

/**
 * Clasifica un correo con las reglas.
 * @param {{subject:string, from:string, body:string}} content
 * @return {{categoryId:string, label:string, confidence:number, reasoning:string}}
 */
function classifyWithRulesEngine(content) {
  content = content || {};
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

/**
 * Función de PRUEBA: ejecútala desde el editor (botón "Ejecutar") para verificar
 * que el motor de reglas funciona. Mira el resultado en "Registro de ejecución".
 */
function testRulesEngine() {
  var ejemplos = [
    { subject: 'Nuevo curso de Python disponible', from: 'no-reply@datacamp.com', body: 'Sigue aprendiendo con DataCamp.' },
    { subject: 'Tu informe mensual de inversiones', from: 'noreply@robinhood.com', body: 'Resumen de tu cartera y rendimiento.' },
    { subject: 'Alerta de seguridad', from: 'no-reply@accounts.google.com', body: 'Actividad nueva en tu cuenta de Google.' },
    { subject: '50% de descuento solo hoy', from: 'ofertas@zara.com', body: 'Aprovecha nuestras rebajas en ropa.' },
    { subject: 'Tu paquete está en camino', from: 'noreply@dhl.com', body: 'Número de seguimiento: 123. Salió a reparto.' },
    { subject: 'Tu suscripción se renovará', from: 'info@netflix.com', body: 'Tu plan mensual se renovará pronto.' },
    { subject: 'Hola, ¿comemos el sábado?', from: 'amigo@gmail.com', body: 'Te escribo para vernos.' },
  ];

  for (var i = 0; i < ejemplos.length; i++) {
    var r = classifyWithRulesEngine(ejemplos[i]);
    Logger.log(
      '"' + ejemplos[i].subject + '" → ' + r.label +
      ' (' + Math.round(r.confidence * 100) + '%) | ' + r.reasoning
    );
  }
}
