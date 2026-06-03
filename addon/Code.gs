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
    .setHeader(CardService.newCardHeader().setTitle('Clasificador con Claude'));

  var section = CardService.newCardSection();
  if (!isConfigured()) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        '⚠️ Aún no has configurado el Add-on. Pulsa <b>Configuración</b> para añadir la URL del backend y el secreto.'
      )
    );
    section.addWidget(
      CardService.newTextButton()
        .setText('Configuración')
        .setOnClickAction(CardService.newAction().setFunctionName('onSettings'))
    );
  } else {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'Abre cualquier correo y pulsa <b>Clasificar y etiquetar</b> para organizarlo automáticamente con Claude.'
      )
    );
  }

  return card.addSection(section).build();
}

/** Se ejecuta al abrir un correo. Construye la tarjeta contextual. */
function onGmailMessage(e) {
  if (!isConfigured()) {
    return onHomepage(e);
  }

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Clasificar correo'));

  var section = CardService.newCardSection();
  section.addWidget(
    CardService.newTextParagraph().setText('Usa Claude para asignar una categoría y aplicar la etiqueta correspondiente.')
  );

  var classifyAction = CardService.newAction().setFunctionName('classifyAndLabel');
  section.addWidget(
    CardService.newTextButton()
      .setText('Clasificar y etiquetar')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(classifyAction)
  );

  var previewAction = CardService.newAction().setFunctionName('classifyOnly');
  section.addWidget(
    CardService.newTextButton()
      .setText('Solo previsualizar categoría')
      .setOnClickAction(previewAction)
  );

  return card.addSection(section).build();
}

/* ------------------------------- Acciones -------------------------------- */

/** Clasifica el correo abierto y aplica la etiqueta sugerida. */
function classifyAndLabel(e) {
  return handleClassification(e, true);
}

/** Clasifica el correo abierto sin aplicar la etiqueta (solo muestra el resultado). */
function classifyOnly(e) {
  return handleClassification(e, false);
}

/**
 * Lógica compartida de clasificación.
 * @param {Object} e Evento del Add-on de Gmail.
 * @param {boolean} applyLabel Si se debe aplicar la etiqueta en Gmail.
 */
function handleClassification(e, applyLabel) {
  try {
    var content = getMessageContent(e);
    var result = callBackend(content);

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
      var applyAction = CardService.newAction()
        .setFunctionName('classifyAndLabel');
      section.addWidget(
        CardService.newTextButton()
          .setText('Aplicar esta etiqueta')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(applyAction)
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

/** Crea (si no existe) y aplica una etiqueta de Gmail al hilo del correo. */
function applyGmailLabel(message, labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  message.getThread().addLabel(label);
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
