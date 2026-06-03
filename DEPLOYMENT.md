# Guía de despliegue

El proyecto tiene dos partes:

1. **`backend/`** — Cloud Function (Node.js) que clasifica el correo con la API de Claude.
2. **`addon/`** — Add-on de Gmail (Apps Script) que lee el correo, llama al backend y aplica la etiqueta.

---

## 1. Desplegar el backend (Cloud Functions)

### Requisitos
- Un proyecto de Google Cloud con facturación activa.
- `gcloud` CLI instalado y autenticado (`gcloud auth login`).
- Una clave de la API de Claude (Anthropic Console).

### Pasos

```bash
cd backend

# Define un secreto compartido fuerte (se usará también en el Add-on).
SHARED_SECRET="$(openssl rand -hex 32)"
echo "Guarda este secreto: $SHARED_SECRET"

# Despliega la función (2nd gen). Ajusta región/proyecto según necesites.
gcloud functions deploy classifyEmail \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=classifyEmail \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars="ANTHROPIC_API_KEY=sk-ant-...,ADDON_SHARED_SECRET=$SHARED_SECRET"
```

> **Nota de seguridad:** `--allow-unauthenticated` deja la función accesible por
> URL, pero la protege el header `X-Addon-Secret`. Para producción, considera
> usar Secret Manager para las claves y autenticación IAM con tokens de
> identidad en lugar del secreto compartido.

Mejor aún, usa **Secret Manager** para no exponer la clave:

```bash
echo -n "sk-ant-..." | gcloud secrets create anthropic-api-key --data-file=-

gcloud functions deploy classifyEmail \
  --gen2 --runtime=nodejs20 --region=us-central1 --source=. \
  --entry-point=classifyEmail --trigger-http --allow-unauthenticated \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest" \
  --set-env-vars="ADDON_SHARED_SECRET=$SHARED_SECRET"
```

Al terminar, copia la **URL del trigger** (algo como
`https://us-central1-PROYECTO.cloudfunctions.net/classifyEmail`).

### Probar localmente

```bash
cd backend
npm install
ANTHROPIC_API_KEY=sk-ant-... ADDON_SHARED_SECRET=test npm run dev

# En otra terminal:
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "X-Addon-Secret: test" \
  -d '{"subject":"50% de descuento solo hoy","from":"ofertas@tienda.com","body":"Aprovecha nuestras rebajas en ropa."}'
```

---

## 2. Desplegar el Add-on (Apps Script)

### Opción A — con `clasp` (recomendado)

```bash
npm install -g @google/clasp
clasp login

cd addon
clasp create --type standalone --title "Clasificador de Correos con Claude"
clasp push
```

### Opción B — manual

1. Ve a <https://script.google.com> y crea un proyecto nuevo.
2. Copia el contenido de `addon/Code.gs` y `addon/Config.gs` a archivos `.gs`.
3. En **Configuración del proyecto**, marca "Mostrar el archivo de manifiesto
   `appsscript.json`" y pega el contenido de `addon/appsscript.json`.

### Probar el Add-on

1. En el editor de Apps Script: **Implementar → Probar implementaciones → Instalar**.
2. Abre Gmail, abre un correo y verás el Add-on en la barra lateral derecha.
3. La primera vez, pulsa **Configuración** y rellena:
   - **URL del backend**: la URL de la Cloud Function.
   - **Secreto compartido**: el mismo valor de `ADDON_SHARED_SECRET`.
4. Abre un correo → **Clasificar y etiquetar**.

### Publicar (opcional)

Para distribuirlo: **Implementar → Nueva implementación → Complemento de
Google Workspace**, y publícalo en el Marketplace (requiere verificación de
OAuth para los permisos de Gmail).

---

## Categorías y etiquetas

Las categorías están definidas en `backend/index.js` (`CATEGORIES`). Cada una
genera una etiqueta de Gmail bajo el prefijo `Claude/` (por ejemplo
`Claude/Promociones`). Edita esa lista para personalizarlas.
