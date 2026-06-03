# Gmail-organizer

Dejar de tener problemas con spam, marcas de ropa, periodicos y mensajes de confirmacion JEJE :)

Add-on de **Google Workspace para Gmail** que clasifica y etiqueta tus correos
automáticamente usando la **API de Claude**. La clasificación se ejecuta en una
**Cloud Function** y las etiquetas se aplican con la **Gmail API**.

## ¿Cómo funciona?

```
┌────────────┐   contenido del    ┌──────────────────┐   prompt    ┌──────────┐
│  Add-on    │   correo (POST)    │  Cloud Function  │  ────────▶  │  Claude  │
│  de Gmail  │ ─────────────────▶ │   (backend)      │             │   API    │
│ (Apps      │ ◀───────────────── │                  │  ◀────────  │          │
│  Script)   │   categoría +      └──────────────────┘  categoría  └──────────┘
└────────────┘   etiqueta
      │
      ▼  aplica la etiqueta vía Gmail API
   ┌─────────┐
   │  Gmail  │
   └─────────┘
```

1. Abres un correo; el Add-on muestra una tarjeta con el botón **Clasificar y
   etiquetar**.
2. El Add-on envía asunto, remitente y cuerpo a la Cloud Function.
3. La función llama a Claude (`claude-opus-4-8`) con **salida estructurada** y
   **cacheo de prompts**, y devuelve una categoría.
4. El Add-on crea/aplica la etiqueta correspondiente (`Claude/Promociones`,
   `Claude/Spam`, etc.).

## Estructura

| Carpeta        | Descripción                                                     |
| -------------- | --------------------------------------------------------------- |
| `backend/`     | Cloud Function (Node.js + SDK de Anthropic).                    |
| `addon/`       | Add-on de Gmail (Apps Script: `Code.gs`, `Config.gs`, manifest).|
| `DEPLOYMENT.md`| Guía paso a paso de despliegue.                                 |

## Categorías por defecto

Spam · Promociones · Noticias · Confirmaciones · Finanzas · Trabajo · Personal ·
Redes Sociales · Otros. Se personalizan en `backend/index.js`.

## Despliegue rápido

Consulta **[DEPLOYMENT.md](./DEPLOYMENT.md)** para las instrucciones completas
(Cloud Functions + Apps Script). En resumen:

```bash
# Backend
cd backend && gcloud functions deploy classifyEmail --gen2 --runtime=nodejs20 \
  --trigger-http --entry-point=classifyEmail \
  --set-env-vars="ANTHROPIC_API_KEY=...,ADDON_SHARED_SECRET=..."

# Add-on
cd ../addon && clasp create --type standalone && clasp push
```

Luego abre el Add-on en Gmail, entra en **Configuración** y pega la URL del
backend y el secreto compartido.
