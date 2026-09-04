<div align="center">

<img src="../../web/public/brand/tlsflow-lockup.svg" alt="TLSFlow" width="480">

[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
![Version](https://img.shields.io/badge/version-1.0.0-brightgreen.svg)
![Vue](https://img.shields.io/badge/Vue-3.5+-4FC08D.svg?logo=vue.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-latest-E0234E.svg?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)

**Plataforma de Automatización del Ciclo de Vida de Certificados SSL/TLS de Nivel Empresarial**

[English](README.en.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md)

</div>

---

## ⚠️ Aviso Importante

Por favor, lea cuidadosamente lo siguiente antes de usar este proyecto:

- **Riesgo de Términos de Servicio:** El uso de este proyecto en entornos de producción comercial requiere una licencia comercial o EULA separada. La licencia predeterminada PolyForm Noncommercial 1.0.0 permite únicamente uso no comercial. Por favor, revise el archivo [LICENSE](../../LICENSE) y contacte al titular de los derechos antes del despliegue comercial.

- **Uso Conforme:** Use este proyecto solo en cumplimiento con las leyes y regulaciones de su país o región. Cualquier uso ilegal está estrictamente prohibido.

- **Descargo de Responsabilidad:** Este proyecto se proporciona con fines de aprendizaje técnico, investigación y evaluación. Los autores no asumen responsabilidad por incidentes de producción, pérdida de datos o cualquier otro daño directo o indirecto resultante del uso de este proyecto en entornos no soportados.

---

<p align="center">Comunidad: <a href="https://github.com/tlsflow/TLSFlow/issues">GitHub</a> · <a href="https://docs.tlsflow.com">Docs</a> · <a href="https://t.me/tlsflow">Telegram</a> · <a href="https://discord.gg/KXyhGGRkJ">Discord</a> · Grupo QQ: <code>239991420</code></p>

## Introducción del Producto

### No permita que los certificados expirados arruinen su negocio

Cientos de servidores, decenas de tipos de aplicaciones, diferentes entornos de red: ¿qué hacer cuando los certificados están a punto de expirar? La actualización manual es lenta, propensa a errores y puede derribar el servicio en línea. TLSFlow le ayuda a gestionar certificados, desplegarlos automáticamente y revertir automáticamente cuando hay problemas, para que las actualizaciones de certificados ya no sean una bomba de tiempo.

A través del sistema de plugins y orquestación de flujos de trabajo, es extensible para soportar varios servidores web, servidores de aplicaciones, balanceadores de carga, dispositivos gateway, plataformas en la nube y entornos de contenedores.

### Valor del Producto

| Valor | Descripción |
| --- | --- |
| **Saber cuántos certificados tiene** | No necesita buscar en Excel y correos electrónicos; todos los certificados, en qué máquina están, a qué aplicación están vinculados, cuándo expiran: todo se puede consultar al instante. |
| **Actualización masiva con un clic** | Windows, Linux, plataformas en la nube, dispositivos de red: todos pueden desplegarse automáticamente, sin necesidad de conectarse manualmente por SSH a cada servidor en medio de la noche. |
| **Reversión automática ante fallos** | Respaldo automático antes de actualizar, verificación automática después de actualizar; si se detecta un problema, se revierte inmediatamente a la configuración original, reduciendo el riesgo de interrupción del negocio. |
| **Notificaciones anticipadas de expiración** | Recordatorios automáticos antes de la expiración, alertas inmediatas ante fallos de despliegue a través de WeChat, correo electrónico, DingTalk y otros canales. |

## Desafíos y Puntos Críticos

### La Era de los Certificados de 47 Días Está Llegando

El CA/B Forum aprobó SC081v3 el 11 de abril de 2025, reduciendo gradualmente el período máximo de validez de los certificados TLS/SSL de confianza pública:

| Fase | Validez Máxima | Fecha de Vigencia | Rotaciones Anuales Estimadas |
| --- | ---: | --- | ---: |
| Actual | 1 año | Actual | ~1 vez |
| Primera Fase | 200 días | 15-03-2026 | ~2 veces |
| Segunda Fase | 100 días | 15-03-2027 | ~4 veces |
| Tercera Fase | 47 días | 15-03-2029 | ~8 veces |

La duplicación de la frecuencia de actualización significa que la solicitud, despliegue, verificación y reversión deben convertirse en procesos automatizados reproducibles.

### Personal de Operaciones: ¿Cuántos certificados necesita gestionar la empresa?

- Los dominios públicos están dispersos entre múltiples proveedores de servicios en la nube, los gateways de negocios internos están distribuidos en varias sucursales;
- La información de certificados está dispersa en Excel, correos electrónicos y carpetas compartidas; la cantidad, fechas de expiración y ubicaciones de despliegue son difíciles de contabilizar;
- Cada inventario requiere improvisación, lo que facilita omisiones, duplicaciones y responsabilidades poco claras.

**Solución TLSFlow**: Proporciona un centro de activos de certificados que gestiona uniformemente todos los certificados y sus ubicaciones de despliegue.

### Personal de Implementación: ¿Cómo enfrentar la era de los certificados de 47 días?

- Actualmente, los certificados se renuevan típicamente una vez al año; 200 aplicaciones a 2 horas cada una requieren aproximadamente 400 horas por ciclo;
- Con el período de validez reducido a 47 días, se necesitarán aproximadamente 8 renovaciones anuales, multiplicando proporcionalmente los costos de mano de obra repetitiva;
- Sin un proceso de automatización unificado, solicitar, cargar, configurar, reiniciar y verificar será insostenible.

**Solución TLSFlow**: Proceso de despliegue automatizado que reduce el tiempo de actualización de horas a minutos.

### Personal de Mantenimiento: ¿Ha experimentado interrupciones del negocio por expiración o fallo de instalación de certificados?

- Los certificados expirados pueden causar inaccesibilidad de sitios web, fallos de API en aplicaciones móviles, interrupciones de API con socios;
- El proceso manual tiene muchos pasos; errores de configuración y verificación tardía pueden llevar problemas al entorno de producción;
- Incluso con manejo oportuno, el negocio puede haber estado interrumpido durante horas, generando quejas y cuestionamientos de clientes;
- La falta de registros de cambios unificados y bases de recuperación significa que la resolución de problemas, reversión y análisis post-mortem solo pueden depender de la experiencia manual.

**Solución TLSFlow**: Proporciona alertas de expiración, verificación automática post-despliegue y mecanismos de reversión ante fallos.

### Personal de Seguridad: ¿Qué riesgos de seguridad existen con el uso masivo de certificados comodín en redes internas?

- Un mismo certificado comodín y clave privada se copian a decenas o incluso cientos de servidores internos;
- Cualquier servidor comprometido, filtración de respaldo u operación incorrecta puede causar propagación de la clave privada;
- El alcance del despliegue no se puede rastrear; si un certificado necesita revocarse, la evaluación de impacto y la revisión en toda la red se vuelven difíciles;
- Los límites de uso de claves privadas y los sujetos de despliegue reales no están claros, dificultando las auditorías, rotaciones y responsabilidades de cumplimiento.

**Solución TLSFlow**: Recomienda certificados privados internos, certificados comodín públicos combinados con despliegue automatizado para reducir el riesgo de propagación de claves privadas.

### Gerentes de Equipo: ¿Qué tan lejos está su equipo de la era de los certificados de 47 días?

- Primero, confirme si el inventario de activos está completo: si los certificados, servidores, aplicaciones y responsables pueden corresponderse;
- Luego, evalúe la cobertura de automatización para reducir la dependencia de la experiencia individual, scripts temporales e inicios de sesión manuales;
- Finalmente, verifique si el equipo tiene capacidad de respuesta rápida, trazabilidad de aprobaciones y capacidad de reversión ante fallos;
- Incorpore recordatorios de expiración, verificación de despliegue y registros de ejecución en un ciclo cerrado unificado para enfrentar continuamente el ciclo de 47 días.

**Solución TLSFlow**: Proporciona una solución completa desde inventario de activos, despliegue automático hasta monitoreo y alertas.

## Funcionalidades

### Qué Puede Hacer TLSFlow

| Funcionalidad | Descripción |
| --- | --- |
| **Gestión Unificada de Activos de Certificados** | Gestión centralizada de activos de certificados, versiones, conversión de formatos y verificación de cadena de confianza; soporta múltiples formatos como PEM/PFX/JKS/P7B; detección automática de expiración de certificados y archivo de versiones históricas. |
| **Acceso Multi-fuente de Certificados** | Soporta múltiples fuentes de certificados: importación manual, CA interna (OpenSSL/ACME), certificados de proveedores en la nube (Alibaba Cloud CDN), Microsoft AD CS, etc.; análisis automático de cadena de certificados y mapeo a activos gestionados. |
| **Descubrimiento de Aplicaciones en Entornos Heterogéneos** | Descubrimiento automático de activos de aplicaciones a través de Agent: varios servidores web, servidores de aplicaciones, balanceadores de carga, etc.; identifica vinculación de certificados actual y compatibilidad. |
| **Despliegue Automatizado por Flujo de Trabajo** | Orquestación de flujos de trabajo de despliegue de certificados basada en DSL; soporta ejecución remota SSH, llamadas CURL API, transferencia de archivos; incluye pre-verificación, respaldo, validación y garantías de reversión. |
| **Sistema de Plugins Extensible** | 20 plugins de aplicaciones de alta frecuencia integrados que cubren servidores web, middleware de aplicaciones, balanceadores de carga, dispositivos gateway, plataformas en la nube, etc.; soporta extensión de plugins personalizados por el usuario para adaptarse a cualquier entorno objetivo. |
| **Monitoreo Continuo y Alertas** | Monitoreo en tiempo real de expiración de certificados, deriva de vinculación, fallos de verificación de cadena, anomalías de despliegue; alertas push multicanal a través de correo electrónico/Webhook/DingTalk/WeChat Work/Feishu/Slack/Telegram. |
| **Flujos de Aprobación y Auditoría** | Soporta activación de aprobación por nivel de riesgo y tipo de operación (instalación/activación de plugins, ejecución de flujos de trabajo, operaciones de reversión); registro completo de logs de operación y snapshots de ejecución. |
| **Control de Permisos de Grano Fino** | Basado en modelo RBAC + autorización de objetos; asignación de permisos por dimensión de activos de certificados, aplicaciones, Agent; soporta aislamiento de inquilinos y colaboración interdepartamental. |

### Puntos Críticos en Escenarios Reales

| Problema que Puede Encontrar | Cómo lo Resuelve TLSFlow |
| --- | --- |
| Información de certificados dispersa en correos, Excel, unidades compartidas; no se puede encontrar temporalmente | Todos los certificados gestionados centralmente; búsqueda para encontrar ubicación de uso y responsable. |
| Después de actualizar, no sabe si ha tenido efecto; descubre error de configuración solo tras quejas de usuarios | Después de actualizar, acceso HTTPS automático; solo se considera completo si la huella digital es correcta. |
| Cuando hay problemas, no sabe quién cambió qué; imposible rastrear | Cada actualización registra operador, tiempo y contenido modificado; se puede revisar en cualquier momento. |
| Zona de producción prohíbe acceso externo; no se puede instalar Agent; solo inicio de sesión manual | Use Gateway para conexión activa, o despliegue directamente vía SSH sin proxy. |

## Ventajas del Producto

### Por Qué TLSFlow es Más Adecuado para Empresas

- **También puede gestionar sistemas antiguos**: Muchos sistemas no pueden instalar Agent, y las redes tienen zonas de aislamiento. TLSFlow proporciona múltiples métodos de acceso; sistemas antiguos y redes aisladas pueden incorporarse a la gestión sin transformaciones a gran escala.
- **Reversión automática ante fallos de actualización de certificados**: Respaldo automático antes de actualizar; recuperación automática de configuración original basada en listas de respaldo y puntos de control al fallar la verificación; soporta activación automática de estrategias de fallo y reversión manual, evitando revertir configuraciones apresuradamente después de que el negocio se cuelga.
- **Puede gestionar tanto aplicaciones comunes como especiales**: Aplicaciones de alta frecuencia a través de plugins integrados de uso directo; dispositivos poco comunes y procesos especiales pueden orquestar pasos de actualización mediante DSL de flujo de trabajo; extensibilidad ilimitada.
- **Situación de asociación de certificados clara de un vistazo**: Cada certificado vinculado a servidor específico, sitio y aplicación; cuando hay problemas, se puede confirmar rápidamente el alcance del impacto.
- **Control de permisos completo**: Diferentes roles con diferentes permisos; operaciones sensibles requieren aprobación según políticas; contraseñas y claves privadas no se muestran en texto plano en logs.
- **Logs de auditoría completos**: Cada actualización puede ver pasos de ejecución, certificados utilizados y cambios de configuración; cuando hay problemas se puede revisar; no es operación de caja negra.

## Escenarios Aplicables

- **Entornos heterogéneos complejos**: Coexisten múltiples servidores web, middleware de aplicaciones, balanceadores de carga, dispositivos gateway y plataformas en la nube; el mantenimiento manual es insostenible;
- **Existen zonas de aislamiento y sistemas antiguos**: Las zonas de producción no pueden instalar software arbitrariamente, los sistemas antiguos no pueden actualizarse, pero los certificados aún necesitan actualizarse;
- **Red interna completamente desconectada**: El entorno de producción está físicamente aislado de Internet; no se pueden usar servicios de certificados en línea de nube pública;
- **Requiere aprobación y registro**: Los cambios de certificados son operaciones sensibles que requieren flujos de aprobación, trazabilidad de operaciones y rastreo completo.

Las actualizaciones de certificados ya no son una bomba de tiempo. TLSFlow, con gestión unificada de activos, despliegue automático, reversión segura y alertas continuas, ayuda a los equipos a enfrentar ciclos de rotación de certificados cada vez más cortos.

## Arquitectura Técnica

El proyecto adopta una arquitectura modular en capas: la plataforma central gestiona uniformemente datos, permisos y contratos de ejecución; la capa de ejecución puede reemplazarse según el objetivo.

| Componente | Tecnología y Responsabilidad |
| --- | --- |
| Consola Web | Vue 3, TypeScript, Vite, Pinia, vue-i18n |
| Backend | NestJS, TypeScript; divide módulos de dominio por límites de negocio y proporciona interfaces REST/OpenAPI |
| Persistencia de Datos | Despliegue estándar usa PostgreSQL 16; evaluación de nodo único usa PGlite |
| Browser Runtime | Node.js, Playwright; proporciona sesiones de navegador aisladas y flujos de credenciales controlados |
| TLS Inspector | Servicio Node.js independiente para handshake TLS y análisis de estado de certificados |
| Full Agent / CA Node | Programa nativo Go; soporta ejecución de host y límites de emisión CA aislados respectivamente |
| Runtime de Extensiones | Manifest, Host API, Runner, Workflow DSL y directorio de compatibilidad |
| Métodos de Despliegue | standard usa Docker Compose; small usa contenedor único `docker run` |

## Inicio Rápido

### Requisitos Previos

- Host Linux, macOS o NAS
- Docker CLI; despliegue estándar requiere adicionalmente Docker Compose v2
- Acceso a dispositivos objetivo y servicios de certificados
- Para producción, use claves de runtime aleatorias y persistentes

El despliegue de imágenes precompiladas no requiere Node.js, Go, Buildx ni código fuente.

### Despliegue de Nodo Único

Adecuado para entornos pequeños con menos de 50 activos de aplicaciones; usa base de datos embebida PGlite, ejecución en contenedor único.

Inicio rápido (usando volumen nombrado de Docker):

```bash
docker run -d \
  --name tlsflow-small \
  --restart unless-stopped \
  -p 8085:3003 \
  -e GCAC_PUBLIC_BASE_URL=http://your-host:8085 \
  -e GCAC_SECRET_KEK=your-random-kek \
  -v tlsflow-small-data:/app/data \
  tlsflow/tlsflow-small:latest
```

**Importante**:
- Para producción, debe reemplazar `GCAC_SECRET_KEK` con una clave aleatoria
- La contraseña de administrador se establece durante el asistente de inicialización en el primer acceso
- Dirección de acceso predeterminada: `http://<dirección-host>:8085/`

Para configuración detallada de parámetros, vinculación de directorios host, proxy inverso HTTPS y otros escenarios, consulte la documentación completa.

### Despliegue Estándar

Adecuado para entornos formales y escenarios multi-inquilino; usa base de datos PostgreSQL 16; soporta sesiones de navegador Browser Runtime.

**1. Preparar archivo de configuración**

```bash
cp docker/.env.example docker/.env
```

Edite `docker/.env`, complete al menos:
- `GCAC_RELEASE_VERSION`: Etiqueta de imagen (use versión fija para producción)
- `GCAC_PUBLIC_BASE_URL`: Dirección web accesible por Agent
- `POSTGRES_PASSWORD`: Contraseña de base de datos
- `GCAC_TOKEN_SECRET`: Clave de firma de token de inicio de sesión
- `GCAC_SECRET_KEK`: Clave raíz de cifrado (debe permanecer invariable a largo plazo)

**2. Iniciar servicios**

```bash
cd docker
docker compose pull
docker compose up -d
```

**3. Verificar**

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

Confirme que el estado de `db` es `healthy`; acceda a `http://<dirección-host>:8085/` para completar el asistente de inicialización.

**Browser Runtime** (opcional): Cuando necesite credenciales de inicio de sesión del navegador, establezca `BROWSER_RUNTIME_ENABLED=true` en `.env` y complete `BROWSER_RUNTIME_SHARED_SECRET`, luego ejecute `docker compose up -d`.

Para configuración detallada de recursos, directorios de datos, respaldo y recuperación, consulte la documentación completa.

## Estructura del Proyecto

```text
backend/          Backend NestJS, migraciones de base de datos, host de plugins y orquestación de ejecución
web/              Consola de administración Vue 3
browser-runtime/  Runtime de navegador controlado
tls-inspector/    Servicio de sondeo de handshake TLS y certificados
agents/           Agent Windows/Linux, CA Node y Gateway Agent
docker/           Dockerfile, Compose, herramientas de construcción de imágenes y paquetes de lanzamiento de Agent
data/             Directorio de plugins en runtime, base de datos, flujos de trabajo y datos de runtime
docs/             Manual de usuario, documentación de desarrollo, guía de operaciones y materiales del producto
specs/            Especificaciones de requisitos y diseño organizadas por dominio
scripts/          Verificación de arquitectura, verificación de compatibilidad, gobernanza de plugins y herramientas de publicación
```

## Desarrollo Secundario y Extensión

### Elegir el Método de Extensión Correcto

1. **Agregar sistema común o entorno autenticado**: Priorice reutilizar capacidades existentes de Agent, SSH, CURL y plataforma; agregue configuración y registros de verificación a través del directorio de compatibilidad; intente lograr cero cambios en el código central.
2. **Agregar producto de alta frecuencia**: Desarrolle plugin de producto, encapsule conexión de dispositivo, confirmación de identidad, descubrimiento de solo lectura, mapeo de activos de aplicación, plan de despliegue y verificación objetivo.
3. **Agregar dispositivo de nicho o API interna**: Escriba Workflow DSL versionado usando pasos controlados como SSH, SFTP, SCP, CURL, condiciones, transformaciones, espera, confirmación manual, extracción y aserciones.
4. **Si realmente necesita nuevo límite de ejecución**: Reevalúe si necesita nueva línea de producto Agent o capacidad de host, y complete primero contratos de protocolo, permisos, auditoría y reversión.

### Límites de Desarrollo de Plugins

- Los plugins declaran identidad, versión, capacidades, permisos y alcance de compatibilidad a través de `Manifest`;
- Los plugins por defecto solo usan Host API, Secret, Artifact, auditoría, bloqueos y autorización de ejecución proporcionados por el host;
- Los plugins integrados se ubican en `backend/src/modules/plugins/builtin-plugins/<pluginId>/`;
- Los plugins de usuario se colocan en `data/plugins/`, publicados a través de la interfaz unificada de importación de paquetes de plugins;
- Los recursos de flujo de trabajo de plugins deben sincronizarse con la versión del plugin; antes de publicar, debe completarse la prueba del proceso de actualización de certificados y guardar registros de iteración;
- Los plugins no pueden eludir el host para leer directamente datos de inquilinos, credenciales en texto plano o ejecutar arbitrariamente procesos del host.

Documentación de entrada: [Desarrollo de Plugins](../../docs/Documentation/developer/plugin-development.md), [Capacidades Host-Plugin](../../docs/Documentation/developer/host-plugin-capabilities.md), [Desarrollo de Flujos de Trabajo](../../docs/Documentation/developer/workflow-development.md).

### Límites de DSL de Flujo de Trabajo

Las plantillas de flujo de trabajo usan el protocolo privado del proyecto `gcac.workflow/v1`. Las fuentes de plantillas solo son:

- Plantillas integradas: `backend/src/modules/workflow-templates/builtin-workflows`;
- Plantillas importadas por usuario: `data/workflows` (creado bajo demanda en runtime, no es directorio de plantillas integradas).

Contraseñas, tokens, claves privadas y artefactos de certificados deben referenciarse a través de `SecretRef` o Artifact Slot; no pueden escribirse en DSL, variables ordinarias, logs o snapshots de ejecución. El proceso de despliegue debe mantener las fases `prepare → backup → install → refresh → verify`; la reversión usa la versión y snapshot de entrada del flujo de trabajo original.

### Desarrollo Local y Verificación

El repositorio no requiere que los servicios de desarrollo se inicien automáticamente como parte de la entrega del README. Las entradas comunes de construcción y prueba son las siguientes:

```bash
# Construcción backend
npm --prefix backend run build

# Verificación de tipos frontend y construcción de producción
npm --prefix web run build

# Construcción Browser Runtime
npm --prefix browser-runtime run build

# Pruebas TLS Inspector
npm --prefix tls-inspector test

# Pruebas unitarias y de contrato frontend
npm --prefix web run test:unit
```

Las pruebas completas de backend, verificación de arquitectura de compatibilidad, verificación de versión de plugins y construcción de Agent tienen requisitos ambientales adicionales; ejecute según la documentación del módulo correspondiente y especificaciones del proyecto. Pasar pruebas no equivale a haber completado la aceptación de dispositivos de proveedor reales, CA externas, redes aisladas o reversión de producción.

## Seguridad y Límites de Producción

- `GCAC_SECRET_KEK` es la clave raíz de descifrado de materiales de seguridad en runtime; debe respaldarse independientemente; prohibido escribir en código, logs, documentación pública o navegador;
- No coloque claves privadas de emisión de licencias en repositorio, imágenes o variables de entorno de contenedor; despliegues públicos solo necesitan clave pública de confianza de licencia;
- Browser Runtime de versión estándar solo debe accederse a través de intranet y proxy web;
- Materiales sensibles como certificados, claves privadas, tokens, contraseñas PFX/JKS no deben entrar en variables ordinarias, logs de ejecución o plantillas de flujo de trabajo;
- La versión objetivo, condiciones de permisos, canal de ejecución y compatibilidad real deben aceptarse por separado; código estático, Schema y pruebas unitarias no pueden reemplazar verificación en sitio;
- La topología estándar Compose está orientada a ejecución de nodo único, no proporciona clúster de conmutación por error automática; antes de actualizar y recuperar, respalde base de datos, flujos de trabajo, plugins de usuario y materiales de seguridad en runtime;
- Las capacidades de ACME, CA externa, API de proveedores y redes complejas evolucionarán con las versiones; refiérase a la documentación de usuario actual, directorio de compatibilidad de plugins y resultados del entorno real.

## Documentación Oficial

Para manual de uso completo, documentación de desarrollo, materiales del producto y especificaciones técnicas, visite:

**https://docs.tlsflow.com**

## Licencia

Este proyecto es un proyecto de licencia combinada; primero lea el archivo [LICENSE](../../LICENSE) en el directorio raíz:

- El código fuente central y la implementación oficial usan por defecto **PolyForm Noncommercial 1.0.0**; el uso comercial requiere licencia comercial o EULA separada;
- SDK de plugins, Manifest, contratos Host API y ejemplos de Schema/protocolo públicos usan por defecto **Apache-2.0**;
- Documentación y ejemplos usan por defecto **CC BY 4.0**;
- Plugins de terceros o comunitarios están sujetos a sus licencias y declaraciones adjuntas.

## Posicionamiento del Proyecto

TLSFlow no intenta reemplazar todas las CA, controladores de Kubernetes o herramientas ACME ligeras. Su valor radica en convertir la parte más propensa a descontrolarse "después de la emisión de certificados" —relaciones de activos, despliegue en objetivos heterogéneos, pre-verificación, validación, reversión, aprobación, auditoría y monitoreo continuo— en un conjunto de procesos empresariales unificados, transparentes y extensibles.

**Use activos estructurados para responder "dónde están los certificados", use plugins y flujos de trabajo para responder "cómo desplegar", use pre-verificación y validación para responder "si el despliegue es seguro y efectivo", use reversión y auditoría para responder "cómo rastrear y recuperar cuando hay problemas".**
