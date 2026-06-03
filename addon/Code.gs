/**
 * Add-on de Google Workspace para Gmail: clasifica y etiqueta correos llamando a
 * una Cloud Function que a su vez usa la API de Claude.
 *
 * Flujo:
 *   1. El usuario abre un correo -> onGmailMessage construye la tarjeta.
 *   2. "Clasificar y etiquetar" -> classifyAndLabel obtiene el contenido del
 *      correo, llama al backend y aplica la etiqueta sugerida.
 */

/* ----------------------------- Disparadores ------------------------------ */

/** Página de inicio del Add-on (sin un correo abierto). */
function onHomepage(e) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Organizador de correos'));

  // Sección 1: clasificación por lotes (reglas, gratis).
  var batch = CardService.newCardSection().setHeader('Clasificar la bandeja');
  batch.addWidget(
    CardService.newTextParagraph().setText(
      'El modo <b>reglas</b> es gratis y no necesita configuración. Etiqueta tus correos buscando patrones (remitente y palabras clave).'
    )
  );
  batch.addWidget(
    CardService.newTextButton()
      .setText('Clasificar y archivar la bandeja (reglas)')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName('runBatchNow'))
  );
  if (isAutoEnabled()) {
    batch.addWidget(CardService.newTextParagraph().setText('🔁 Clasificación automática: <b>activada</b> (cada hora).'));
    batch.addWidget(
      CardService.newTextButton()
        .setText('Desactivar automático')
        .setOnClickAction(CardService.newAction().setFunctionName('disableAutoClassify'))
    );
  } else {
    batch.addWidget(
      CardService.newTextButton()
        .setText('Activar clasificación automática (cada hora)')
        .setOnClickAction(CardService.newAction().setFunctionName('setupAutoClassify'))
    );
  }
  card.addSection(batch);

  // Sección 2: estado de la IA (opcional).
  var ai = CardService.newCardSection().setHeader('Modo IA (Claude)');
  if (isConfigured()) {
    ai.addWidget(CardService.newTextParagraph().setText('✅ Backend configurado. Al abrir un correo puedes clasificar con Claude.'));
  } else {
    ai.addWidget(
      CardService.newTextParagraph().setText(
        'Opcional: conecta el backend de Claude para clasificación con IA (más precisa). Mientras tanto, el modo reglas ya funciona.'
      )
    );
  }
  ai.addWidget(
    CardService.newTextButton()
      .setText('Configuración')
      .setOnClickAction(CardService.newAction().setFunctionName('onSettings'))
  );
  card.addSection(ai);

  return card.build();
}

/** Se ejecuta al abrir un correo. Construye la tarjeta contextual. */
function onGmailMessage(e) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Clasificar correo'));

  // Modo reglas: siempre disponible, gratis.
  var rulesSection = CardService.newCardSection().setHeader('Modo reglas (gratis)');
  rulesSection.addWidget(
    CardService.newTextButton()
      .setText('Clasificar y etiquetar (reglas)')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName('classifyAndLabelRules'))
  );
  rulesSection.addWidget(
    CardService.newTextButton()
      .setText('Solo previsualizar (reglas)')
      .setOnClickAction(CardService.newAction().setFunctionName('classifyOnlyRules'))
  );
  card.addSection(rulesSection);

  // Modo IA: solo si el backend está configurado.
  if (isConfigured()) {
    var aiSection = CardService.newCardSection().setHeader('Modo IA (Claude)');
    aiSection.addWidget(
      CardService.newTextButton()
        .setText('Clasificar y etiquetar (Claude)')
        .setOnClickAction(CardService.newAction().setFunctionName('classifyAndLabelClaude'))
    );
    aiSection.addWidget(
      CardService.newTextButton()
        .setText('Solo previsualizar (Claude)')
        .setOnClickAction(CardService.newAction().setFunctionName('classifyOnlyClaude'))
    );
    card.addSection(aiSection);
  }

  return card.build();
}

/* ------------------------------- Acciones -------------------------------- */

/** Acciones de la tarjeta contextual (combinaciones método × aplicar). */
function classifyAndLabelRules(e) { return handleClassification(e, true, 'rules'); }
function classifyOnlyRules(e) { return handleClassification(e, false, 'rules'); }
function classifyAndLabelClaude(e) { return handleClassification(e, true, 'claude'); }
function classifyOnlyClaude(e) { return handleClassification(e, false, 'claude'); }

/**
 * Devuelve la clasificación según el método elegido.
 * @param {Object} content {subject, from, body}
 * @param {string} method 'rules' | 'claude'
 */
function classifyDispatch(content, method) {
  if (method === 'claude') {
    return callBackend(content);
  }
  return classifyWithRulesEngine(content);
}

/**
 * Lógica compartida de clasificación.
 * @param {Object} e Evento del Add-on de Gmail.
 * @param {boolean} applyLabel Si se debe aplicar la etiqueta en Gmail.
 * @param {string} method 'rules' | 'claude'.
 */
function handleClassification(e, applyLabel, method) {
  try {
    var content = getMessageContent(e);
    var result = classifyDispatch(content, method);

    var statusText = '';
    if (applyLabel) {
      applyGmailLabel(content.message, result.label);
      statusText = '✅ Etiqueta aplicada: <b>' + escapeHtml(result.label) + '</b>';
    } else {
      statusText = 'Categoría sugerida: <b>' + escapeHtml(result.label) + '</b>';
    }

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Resultado'));

    var section = CardService.newCardSection();
    section.addWidget(CardService.newTextParagraph().setText(statusText));
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Confianza')
        .setText(formatConfidence(result.confidence))
    );
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Justificación')
        .setText(escapeHtml(result.reasoning || '—'))
        .setWrapText(true)
    );

    if (!applyLabel) {
      var applyFn = method === 'claude' ? 'classifyAndLabelClaude' : 'classifyAndLabelRules';
      section.addWidget(
        CardService.newTextButton()
          .setText('Aplicar esta etiqueta')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(CardService.newAction().setFunctionName(applyFn))
      );
    }

    card.addSection(section);

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card.build()))
      .setNotification(
        CardService.newNotification().setText(
          applyLabel ? 'Correo etiquetado correctamente.' : 'Clasificación lista.'
        )
      )
      .build();
  } catch (err) {
    return errorResponse(err.message);
  }
}

/* ------------------------------ Auxiliares ------------------------------- */

/** Obtiene asunto, remitente y cuerpo del correo abierto. */
function getMessageContent(e) {
  var accessToken = e.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);

  var messageId = e.gmail.messageId;
  var message = GmailApp.getMessageById(messageId);

  return {
    message: message,
    subject: message.getSubject(),
    from: message.getFrom(),
    body: message.getPlainBody(),
  };
}

/** Llama a la Cloud Function de clasificación. */
function callBackend(content) {
  var cfg = getConfig();
  if (!cfg.backendUrl || !cfg.secret) {
    throw new Error('El Add-on no está configurado. Revisa Configuración.');
  }

  var payload = {
    subject: content.subject,
    from: content.from,
    body: content.body,
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Addon-Secret': cfg.secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(cfg.backendUrl, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code !== 200) {
    var msg = 'Error del backend (' + code + ').';
    try {
      var parsedErr = JSON.parse(text);
      if (parsedErr.error) msg = parsedErr.error;
    } catch (ignore) {}
    throw new Error(msg);
  }

  return JSON.parse(text);
}

/** Crea (si no existe), aplica una etiqueta de Gmail y archiva el correo. */
function applyGmailLabel(message, labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  var thread = message.getThread();
  thread.addLabel(label);
  thread.moveToArchive(); // Archiva el correo (lo quita de Inbox).
}

/* ----------------------------- Configuración ----------------------------- */

/** Tarjeta de configuración (acción universal). */
function onSettings(e) {
  var cfg = getConfig();

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Configuración'));

  var section = CardService.newCardSection();
  section.addWidget(
    CardService.newTextInput()
      .setFieldName('backendUrl')
      .setTitle('URL del backend (Cloud Function)')
      .setValue(cfg.backendUrl)
  );
  section.addWidget(
    CardService.newTextInput()
      .setFieldName('secret')
      .setTitle('Secreto compartido (X-Addon-Secret)')
      .setValue(cfg.secret)
  );
  section.addWidget(
    CardService.newTextButton()
      .setText('Guardar')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName('saveSettings'))
  );

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.addSection(section).build()))
    .build();
}

/** Guarda la configuración introducida por el usuario. */
function saveSettings(e) {
  var inputs = e.commonEventObject.formInputs || {};
  var backendUrl = getFormValue(inputs, 'backendUrl');
  var secret = getFormValue(inputs, 'secret');

  var props = getProps();
  props.setProperty(PROP_BACKEND_URL, backendUrl);
  props.setProperty(PROP_ADDON_SECRET, secret);

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Configuración guardada.'))
    .setNavigation(CardService.newNavigation().popToRoot())
    .build();
}

/* --------------------- Clasificación por lotes (reglas) ------------------- */

var AUTO_HANDLER = 'autoClassifyInbox';

/** Conjunto de nombres de etiqueta que crea el organizador (desde RULES). */
function organizerLabelSet() {
  var set = {};
  for (var i = 0; i < RULES.length; i++) {
    set[RULES[i].label] = true;
  }
  set['Otros'] = true;
  return set;
}

/** ¿Hay un disparador automático activo? */
function isAutoEnabled() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === AUTO_HANDLER) return true;
  }
  return false;
}

/** Botón "Clasificar la bandeja": procesa muchos correos de golpe. */
function runBatchNow(e) {
  // Procesa hasta 200 hilos por tanda (con guarda de tiempo dentro del bucle).
  var count = classifyInboxThreads(GmailApp.getInboxThreads(0, 200));
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(
        'Listo: ' + count + ' correos etiquetados y archivados. Vuelve a pulsar para procesar más.'
      )
    )
    .build();
}

/** Función ejecutada por el disparador horario. */
function autoClassifyInbox() {
  // Solo correos del último día para no reprocesar toda la bandeja cada hora.
  var threads = GmailApp.search('in:inbox newer_than:1d', 0, 50);
  classifyInboxThreads(threads);
}

/**
 * Clasifica y etiqueta una lista de hilos con el motor de reglas.
 * Omite los que ya tengan una etiqueta del organizador.
 * @return {number} cuántos hilos se etiquetaron.
 */
function classifyInboxThreads(threads) {
  var processed = 0;
  var start = new Date().getTime();
  var MAX_MS = 4.5 * 60 * 1000; // margen bajo el límite de 6 min de Apps Script.

  for (var i = 0; i < threads.length; i++) {
    if (new Date().getTime() - start > MAX_MS) break; // no exceder el tiempo límite.

    var thread = threads[i];
    if (hasOrganizerLabel(thread)) continue;

    var messages = thread.getMessages();
    if (!messages.length) continue;
    var msg = messages[messages.length - 1]; // mensaje más reciente del hilo

    var result = classifyWithRulesEngine({
      subject: msg.getSubject(),
      from: msg.getFrom(),
      body: msg.getPlainBody(),
    });

    var label = GmailApp.getUserLabelByName(result.label) || GmailApp.createLabel(result.label);
    thread.addLabel(label);
    thread.moveToArchive(); // archiva el hilo (lo saca de Inbox), igual que el modo individual.
    processed++;
  }
  return processed;
}

/** ¿El hilo ya tiene una etiqueta del organizador? */
function hasOrganizerLabel(thread) {
  var known = organizerLabelSet();
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (known[labels[i].getName()]) return true;
  }
  return false;
}

/** Activa la clasificación automática horaria. */
function setupAutoClassify(e) {
  if (!isAutoEnabled()) {
    ScriptApp.newTrigger(AUTO_HANDLER).timeBased().everyHours(1).create();
  }
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Clasificación automática activada (cada hora).'))
    .setNavigation(CardService.newNavigation().updateCard(onHomepage(e)))
    .build();
}

/** Desactiva la clasificación automática. */
function disableAutoClassify(e) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === AUTO_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Clasificación automática desactivada.'))
    .setNavigation(CardService.newNavigation().updateCard(onHomepage(e)))
    .build();
}

/* ------------------------------- Utilidades ------------------------------ */

function getFormValue(formInputs, fieldName) {
  if (formInputs[fieldName] && formInputs[fieldName].stringInputs) {
    var values = formInputs[fieldName].stringInputs.value;
    return values && values.length ? values[0].trim() : '';
  }
  return '';
}

function formatConfidence(confidence) {
  if (typeof confidence !== 'number') return '—';
  return Math.round(confidence * 100) + '%';
}

function errorResponse(message) {
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Error: ' + (message || 'desconocido'))
    )
    .build();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
