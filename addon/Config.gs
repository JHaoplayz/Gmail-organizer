/**
 * Configuración del Add-on.
 *
 * La URL del backend y el secreto compartido se guardan en las propiedades del
 * usuario (PropertiesService) y se editan desde la tarjeta de "Configuración".
 * Así no quedan credenciales escritas en el código fuente.
 */

var PROP_BACKEND_URL = 'BACKEND_URL';
var PROP_ADDON_SECRET = 'ADDON_SECRET';
var PROP_AUTO_LABEL = 'AUTO_LABEL';

/** Devuelve el almacén de propiedades del usuario. */
function getProps() {
  return PropertiesService.getUserProperties();
}

/** Lee la configuración actual. */
function getConfig() {
  var props = getProps();
  return {
    backendUrl: props.getProperty(PROP_BACKEND_URL) || '',
    secret: props.getProperty(PROP_ADDON_SECRET) || '',
    autoLabel: props.getProperty(PROP_AUTO_LABEL) === 'true',
  };
}

/** Indica si el Add-on está listo para llamar al backend. */
function isConfigured() {
  var cfg = getConfig();
  return cfg.backendUrl !== '' && cfg.secret !== '';
}
