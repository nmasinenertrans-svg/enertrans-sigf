# ENERTRANS SIGF - Contexto Vivo del Proyecto

Ultima actualizacion: 2026-03-21
Responsable de actualizacion: Codex (este chat)
Objetivo: que cualquier dev (o nuevo chat) tenga contexto operativo completo sin depender del historial conversacional.

## 1) Que es esta app

ENERTRANS SIGF es una SPA React + TypeScript para gestion integral de flota.
Incluye:
- Flota (alta/edicion/detalle de unidades)
- Mantenimiento
- Auditorias operativas
- Ordenes de trabajo
- Reparaciones
- Pedidos externos
- Inventario
- Movimientos
- Reportes
- Tareas
- Usuarios/perfil
- Notificaciones
- Modo mantenimiento del sistema

## 2) Stack y runtime

- Frontend: React 19 + TypeScript + Vite
- Routing: react-router-dom
- Estilos: Tailwind
- Persistencia local: localStorage + IndexedDB (cola offline)
- API: `src/services/api/apiClient.ts` (Bearer token)
- Build: `npm run build` (`tsc -b && vite build`)

## 3) Estructura principal

Rutas:
- Definicion de paths: `src/core/routing/routePaths.ts`
- Router principal: `src/core/routing/AppRouter.tsx`

Layout/base:
- `src/core/layout/AppLayout.tsx`
- `src/core/layout/TopHeader.tsx`
- `src/core/layout/Sidebar.tsx`

Modulos funcionales (`src/modules/*`):
- `auth`, `dashboard`, `fleet`, `maintenance`, `audits`, `tasks`, `movements`,
  `workOrders`, `externalRequests`, `repairs`, `inventory`, `reports`,
  `users`, `system`

Servicios clave:
- API: `src/services/api/apiClient.ts`
- Cola offline (IndexedDB): `src/services/offline/queue.ts`
- Motor de sincronizacion offline: `src/services/offline/sync.ts`
- Telemetria local de sync: `src/services/offline/telemetry.ts`

## 4) Modelo de seguridad y acceso

- Login por token (guardado en localStorage)
- Rutas protegidas por:
  - `RequireAuth`
  - `RequirePermission`
  - feature flags (`RequireFeatureFlag`)
- Las flags se cargan desde `/settings/features` en `AppLayout`.

## 5) Flujo de datos de alto nivel

1. `AppLayout` carga datos remotos cuando hay usuario + online.
2. Se mergea remoto con local y con payloads en cola offline (segun modulo).
3. `useOfflineSync` dispara sync periodico y por eventos (`online`, `visibilitychange`).
4. `TopHeader` muestra estado online/offline, pendientes y (ahora) bloqueados.

## 6) Offline-first (estado actual)

### Cola
- Store IndexedDB `enertrans-offline`, object store `queue`.
- Item base:
  - `id`, `type`, `payload`, `createdAt`
  - `attemptCount`, `lastAttemptAt`, `lastError`
  - `blocked` (nuevo, para pausa automatica por demasiados intentos)

### Politica de sync
- Reintento normal en errores recuperables.
- Errores no recuperables (400/404/409/422): descarte del item.
- `audit.create` con 409: descarte (ya existe en servidor).
- Si un item llega a 5 intentos fallidos: `blocked=true` (no reintenta automatico).
- Reintento manual individual desbloquea el item y lo intenta nuevamente.

### Integridad de adjuntos
- Antes: algunas cargas de adjuntos podian fallar en silencio y aun asi crear registro remoto incompleto.
- Ahora: si falla carga de foto/adjunto en sync, se corta ese item y queda como fallo (no se crea registro incompleto).

## 7) Telemetria local de sync (nuevo)

Persistencia local en `localStorage`:
- key: `enertrans.offline.syncTelemetry.v1`

Eventos registrados:
- `queue.enqueued`
- `sync.success`
- `sync.failure`
- `sync.dropped`
- `sync.blocked`
- `sync.skipped.blocked`
- `sync.unblocked.manual`

Resumen visible en modal DEV de cola:
- totales de encolados, exitos, fallos, descartes, bloqueos, etc.
- export JSON de telemetria
- reset de telemetria

## 8) Timeline de cambios (base historica)

Fuente: historial git (ultimos commits visibles en este entorno).

- Fecha: 2026-03-19
  Cambio: Integracion profesional de repuestos comprados al circuito `NDP -> Reparacion`.
  Alcance:
  - NDP (`ExternalRequest`) con `currency`, `partsItems`, `partsTotal`, `eligibilityStatus`, `linkedRepairId`.
  - Reparaciones (`RepairRecord`) con `linkedExternalRequestIds`, `laborCost`, `partsCost`; `realCost` consolidado server-side.
  - Validaciones backend: NDP sin adjunto no elegible, moneda unica por reparacion, NDP ya vinculada rechazada.
  - Cardinalidad: una reparacion puede vincular varias NDP; una NDP solo puede estar en una reparacion.
  - UI: NDP con editor de items y estado de elegibilidad; Reparaciones con seleccion multiple de NDP, resumen de repuestos y mano de obra separada.
  - Compatibilidad runtime: SQL de backfill/columnas y relacion FK para reducir riesgo por drift de schema en produccion.

### Cambios previos recientes (ya en `main`)
- `ca25787` cola offline: filtro "solo con error" + contadores.
- `4562e65` auditorias: conservar locales `PENDING/ERROR` al refrescar desde servidor.
- `f8dcb11` auditorias: permitia sync aun si fallaba foto (esto se endurecio despues en cambios locales actuales).
- `2870f7d` cola/notificaciones: evitar bloqueo global por error individual y sincronizar estado leido.
- `be5dd06` metadata de reintentos + accion de reintento por item.
- `978591a` refresh de auditorias post-sync + errores visibles.
- `4c58ba9` fix reset estado leido de notificaciones.
- `ae4cc17` evitar auditorias "fantasma" locales.
- `1c44d03` pagina de notificaciones con persistencia de leido.

### Cambios criticos actuales (working tree de este chat, aun no committeados)
- 2026-02-28 - saneamiento de calidad/lint:
  - se corrigieron errores reales `no-unused-vars` en backend y frontend sin alterar comportamiento funcional
    (`backend/src/middleware/maintenance.ts`, `backend/src/routes/movements.ts`,
    `backend/src/routes/settings.ts`, `src/modules/movements/pages/MovementsPage.tsx`).
  - se ajustaron dependencias de hooks para eliminar warnings de `react-hooks/exhaustive-deps`
    (`src/core/layout/AppLayout.tsx`, `src/modules/fleet/pages/FleetDetailPage.tsx`,
    `src/modules/system/pages/MaintenanceModePage.tsx`, `src/modules/tasks/pages/TasksPage.tsx`).
  - estado actual: `npm run lint` en raiz queda limpio (`0 errors`, `0 warnings`).
- 2026-02-28 - optimizacion critica de bundle frontend:
  - `AppRouter` migrado a carga lazy por ruta con `React.lazy` + `Suspense` para evitar importar todos los modulos al arranque.
  - impacto: se fragmento el JS por paginas (chunks dedicados por modulo) y desaparecio el warning de Vite por chunk >500KB.
  - validacion: `npm run lint` y `npm run build` OK.
- 2026-02-28 - mejoras funcionales pedidas por operacion:
  - Auditorias: historial y modal muestran ademas `KM motor`, `Horas motor` y `Horas hidrogrua` junto con observaciones.
    Archivos: `src/modules/audits/types.ts`, `src/modules/audits/services/auditsService.ts`,
    `src/modules/audits/components/AuditHistoryList.tsx`, `src/modules/audits/pages/AuditsPage.tsx`.
  - Flota / perfil de unidad: nuevo item `Rastreo` con checks `ITURAN`, `RSV`, `MICROTRACK`, persistido en `documents.tracking`.
    Archivos: `src/types/domain.ts`, `src/modules/fleet/services/fleetService.ts`,
    `src/modules/fleet/pages/FleetDetailPage.tsx`.
  - Flota / documentacion: nuevo boton `Eliminar archivo` para RTO/Seguro/Izaje/Titulo/Cedula, solo visible para roles `DEV` y `GERENTE`.
    Archivo: `src/modules/fleet/pages/FleetDetailPage.tsx`.
  - Dashboard interactivo completo:
    - cards KPI ya navegables,
    - tablas de donuts (RTO e Izaje) clickeables y navegan a Flota con filtros por documento/estado,
    - ocupacion por cliente clickeable y navega a Flota filtrada por cliente.
    Archivos: `src/modules/dashboard/pages/DashboardPage.tsx`, `src/modules/fleet/pages/FleetListPage.tsx`.
  - Validacion tecnica final de esta tanda:
    - `npm run lint` OK
    - `npm run build` OK
    - `npm run test` OK (7/7)
- Correccion de runtime en paginas con hooks condicionales:
  - `ExternalRequestsPage`,
  - `InventoryPage`,
  - `ReportsPage`.
  Se movieron early returns por feature flag para preservar el orden estable de hooks.
- Correccion en `WorkOrdersPage`:
  - se elimino uso de helpers antes de declaracion (reorden de efectos),
  - se estabilizo lint de efectos de sincronizacion con URL/localStorage.
- Correccion de tipado y robustez:
  - `LoginPage`: eliminacion de `any`, parseo seguro de usuario persistido y validacion de `role`.
  - `offline/sync`: eliminacion de `any` en errores y payloads offline; helpers de tipado seguro.
- `FleetListPage`: eliminacion de setState en `useEffect` para filtro inicial (inicializacion directa desde query param).
- Observabilidad backend: integracion Sentry en Express (`@sentry/node`):
  - `Sentry.init` temprano en bootstrap,
  - integraciones `express` + `prisma`,
  - `setupExpressErrorHandler(app)` en pipeline.
- Observabilidad frontend: integracion Sentry React (`@sentry/react`):
  - `Sentry.init` en `src/main.tsx`,
  - `ErrorBoundary` global envolviendo `<App />`,
  - activacion condicionada por `VITE_SENTRY_DSN`.
- Sourcemaps frontend para Sentry:
  - `@sentry/vite-plugin` integrado en `vite.config.ts`,
  - upload condicional en build (solo si existen `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`),
  - release unificado por `SENTRY_RELEASE`.
- Configuracion via env:
  - `SENTRY_DSN`,
  - `SENTRY_ENVIRONMENT`,
  - `SENTRY_TRACES_SAMPLE_RATE`,
  - `VITE_SENTRY_DSN`,
  - `VITE_SENTRY_ENVIRONMENT`,
  - `VITE_SENTRY_TRACES_SAMPLE_RATE`.
- Error API tipado (`ApiRequestError`) para decisiones robustas por status.
- `AppLayout.safeRequest` migrado de `string includes` a manejo por `ApiRequestError.status` (401/403).
- Motor sync endurecido:
  - descarte por no recuperables,
  - bloqueo automatico por 5 intentos,
  - desbloqueo manual en reintento individual.
- Integridad estricta de adjuntos (no mas perdida silenciosa).
- Telemetria local completa de sync + UI DEV para resumen/export/reset.
- Estado global sync:
  - nuevo `blockedCount`,
  - alerta visible en badge de header,
  - fix para no dejar `isSyncing` atascado si hay excepcion,
  - manejo defensivo para evitar promesas rechazadas no controladas en `online/visibility/interval`.
- Correccion de texto corrupto en notificaciones (`â€¢`/separador).
- Suite de regresion con Vitest para sync:
  - drop no recuperable (422),
  - bloqueo por max intentos,
  - desbloqueo manual + exito,
  - fallo adjunto evita POST de auditoria.
- Suite adicional para hook/UI:
  - `useOfflineSync`: conteo `pending/blocked` y no quedarse en `isSyncing=true` tras fallo,
  - `TopHeader`: visualizacion de `Bloqueados: N` en badge de estado.
- Tooling de tests frontend agregado: `vitest`, `@testing-library/react`, `jsdom`.
- Dependencia backend agregada: `@sentry/node`.
- Dependencia frontend agregada: `@sentry/react`.
- Dependencia build agregada: `@sentry/vite-plugin`.
- Fecha: 2026-02-28
  Cambio: Modo de auditoria manual configurable desde `Mantenimiento > Modulos y botones`.
  Archivos:
  - `backend/src/routes/settings.ts`
  - `backend/src/routes/audits.ts`
  - `backend/src/routes/workOrders.ts`
  - `src/types/domain.ts`
  - `src/core/context/appState.ts`
  - `src/modules/system/pages/MaintenanceModePage.tsx`
  - `src/modules/audits/services/auditsService.ts`
  - `src/modules/audits/pages/AuditsPage.tsx`
  - `src/services/offline/sync.ts`
  - `src/core/layout/AppLayout.tsx`
  - `src/modules/workOrders/pages/WorkOrdersPage.tsx`
  Riesgo mitigado:
  - Evita generacion automatica de OT y re-auditorias cuando negocio requiere operacion manual.
  - Exige PDF en auditorias manuales y mantiene trazabilidad de informe.
  Riesgo residual:
  - Las OT cerradas historicas con `pendingReaudit=true` previas al cambio quedan como legado hasta ser gestionadas.
- Fecha: 2026-02-28
  Cambio: Toggle de interactividad de dashboard (`interactiveDashboard`) para activar/desactivar clicks en tarjetas y graficos.
  Archivos:
  - `backend/src/routes/settings.ts`
  - `src/types/domain.ts`
  - `src/core/context/appState.ts`
  - `src/modules/system/pages/MaintenanceModePage.tsx`
  - `src/modules/dashboard/pages/DashboardPage.tsx`
  Riesgo mitigado:
  - Permite dejar dashboard en modo solo lectura visual sin navegacion interactiva.
  Riesgo residual:
  - Los modulos destino siguen operativos; solo se bloquea la navegacion directa desde dashboard.
- Fecha: 2026-03-03
  Cambio: Endpoint forense backend para trazabilidad de auditorias en produccion.
  Archivos:
  - `backend/src/routes/audits.ts`
  Riesgo mitigado:
  - Permite verificar rapidamente si una auditoria existe en servidor por unidad/auditor/rango temporal.
  Riesgo residual:
  - Si una auditoria nunca llego al backend por fallo de red previo, el endpoint no puede recuperarla; solo confirma ausencia.
- Fecha: 2026-03-05
  Cambio: Registro y visualizacion de ultimo login por usuario en panel DEV de usuarios.
  Archivos:
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/users.ts`
  - `src/types/domain.ts`
  - `src/modules/auth/pages/LoginPage.tsx`
  - `src/modules/users/pages/UsersPage.tsx`
  Riesgo mitigado:
  - Permite auditar actividad reciente de cuentas y detectar usuarios inactivos o accesos recientes sin depender de logs externos.
  Riesgo residual:
  - El dato se guarda en `AppSettings.featureFlags` (mapa por usuario), no como columna dedicada en `User`; si en el futuro se requiere analitica avanzada conviene migrarlo a tabla propia.
- Fecha: 2026-03-05
  Cambio: Se habilita la coexistencia de multiples OT abiertas por la misma unidad cuando la auditoria resulta RECHAZADA.
  Archivos:
  - `backend/src/routes/audits.ts`
  Riesgo mitigado:
  - Evita bloquear OT independientes para un dominio que ya tenga una OT abierta por otra auditoria.
  Riesgo residual:
  - Puede aumentar la cantidad de OT abiertas en paralelo para una unidad; la operacion debe gestionar prioridad y cierre para evitar dispersion.
- Fecha: 2026-03-05
  Cambio: Buscador en selector de unidad dentro de formulario de OT (patente/codigo, cliente, marca y modelo).
  Archivos:
  - `src/modules/workOrders/components/WorkOrderForm.tsx`
  Riesgo mitigado:
  - Reduce errores operativos y tiempo en mobile al elegir unidad entre flotas grandes.
  Riesgo residual:
  - El filtro usa coincidencia por texto; si se requiere exactitud estricta por dominio, podria agregarse modo de busqueda exacta.
- Fecha: 2026-03-05
  Cambio: Alta de OT forzada a estado `ABIERTA` sin selector manual de estado en formulario.
  Archivos:
  - `src/modules/workOrders/components/WorkOrderForm.tsx`
  - `src/modules/workOrders/services/workOrdersService.ts`
  - `src/modules/workOrders/pages/WorkOrdersPage.tsx`
  - `backend/src/routes/workOrders.ts`
  Riesgo mitigado:
  - Evita puentear flujo operativo creando OT nuevas como `EN PROCESO` o `CERRADA`.
  Riesgo residual:
  - Cambios de estado deben hacerse por acciones operativas posteriores (ej. cierre), no al alta.
- Fecha: 2026-03-05
  Cambio: Trazabilidad de uso por usuario con `ultimo acceso` (actividad) ademas de `ultimo login`.
  Archivos:
  - `backend/src/middleware/auth.ts`
  - `backend/src/routes/auth.ts`
  - `backend/src/routes/users.ts`
  - `src/types/domain.ts`
  - `src/modules/auth/pages/LoginPage.tsx`
  - `src/modules/users/pages/UsersPage.tsx`
  Riesgo mitigado:
  - Evita falsos "Sin registro" en usuarios que no reloguean pero usan la app con sesion activa.
  Riesgo residual:
  - La actividad se actualiza con throttle (5 min) para no sobrecargar DB; no representa segundos exactos.
- Fecha: 2026-03-05
  Cambio: Eliminacion de usuarios con confirmacion real de backend (sin borrado visual falso) y error explicito por historial asociado.
  Archivos:
  - `backend/src/routes/users.ts`
  - `src/modules/users/pages/UsersPage.tsx`
  Riesgo mitigado:
  - Evita que un usuario parezca eliminado localmente pero reaparezca al recargar.
  Riesgo residual:
  - Usuarios con auditorias/tareas asociadas no se pueden eliminar fisicamente; requieren estrategia de desactivacion si negocio exige ocultarlos.
- Fecha: 2026-03-05
  Cambio: Doble confirmacion para eliminar usuario (modal con nombre del usuario).
  Archivos:
  - `src/modules/users/pages/UsersPage.tsx`
  Riesgo mitigado:
  - Reduce eliminaciones accidentales en panel de usuarios.
  Riesgo residual:
  - No reemplaza politicas de permisos; solo agrega capa de confirmacion UI.
- Fecha: 2026-03-06
  Cambio: Remitos con numeracion oficial automatica `R-0000001` incremental y etiqueta `ENTREGA` en UI.
  Archivos:
  - `backend/src/routes/movements.ts`
  - `src/modules/movements/pages/MovementsPage.tsx`
  - `src/modules/movements/services/movementsService.ts`
  - `src/modules/fleet/components/FleetMovementsPanel.tsx`
  Riesgo mitigado:
  - Evita carga manual/duplicada del numero de remito y estandariza nomenclatura operativa.
  Riesgo residual:
  - Si existe historico previo con otro formato, conviviran formatos antiguos y nuevos en listados.
- Fecha: 2026-03-06
  Cambio: Endurecimiento del alta de auditorias para mobile: subida previa de fotos a storage + timeout explicito en `POST /audits` y refresco.
  Archivos:
  - `src/modules/audits/pages/AuditsPage.tsx`
  Riesgo mitigado:
  - Evita cuelgues por payload grande en `POST /audits` y por requests sin timeout en redes inestables.
  Riesgo residual:
  - Si falla storage, la auditoria cae a flujo local/cola y depende de sincronizacion posterior.
- Fecha: 2026-03-07
  Cambio: Compresion automatica de fotos en auditorias antes de guardar/subir (sin alterar PDFs).
  Archivos:
  - `src/modules/audits/services/auditsService.ts`
  - `src/modules/audits/pages/AuditsPage.tsx`
  Riesgo mitigado:
  - Reduce uso de Storage/egreso en Supabase y baja probabilidad de fallos por cargas pesadas (ej. 60 fotos).
  Riesgo residual:
  - Si la foto ya esta optimizada, puede no reducirse; en ese caso se mantiene original para no degradar calidad innecesariamente.
- Fecha: 2026-03-07
  Cambio: Hardening anti-duplicados y red inestable para alta de auditorias/OT.
  Archivos:
  - `backend/src/routes/audits.ts`
  - `backend/src/routes/workOrders.ts`
  - `src/modules/audits/pages/AuditsPage.tsx`
  - `src/modules/workOrders/pages/WorkOrdersPage.tsx`
  - `src/modules/workOrders/components/WorkOrderForm.tsx`
  Riesgo mitigado:
  - Evita altas duplicadas por doble toque/reintento en red inestable (AU/RAU/OT) y muestra aviso explicito de red inestable.
  Riesgo residual:
  - El anti-duplicado usa ventana temporal y similitud de payload; casos operativos extremadamente similares en minutos cercanos podrian considerarse duplicado.
- Fecha: 2026-03-07
  Cambio: Refuerzo de ciclo de vida de archivos de auditoria (prevencion de huÃ©rfanos).
  Archivos:
  - `backend/src/routes/files.ts`
  - `backend/src/routes/audits.ts`
  - `src/services/offline/sync.ts`
  - `src/modules/audits/pages/AuditsPage.tsx`
  - `backend/scripts/reconcileAuditStorage.ts`
  - `backend/package.json`
  Riesgo mitigado:
  - Evita re-subir fotos ya pre-cargadas en reintentos offline y elimina adjuntos de storage al borrar auditorias.
  - Agrega script operativo para detectar/limpiar huÃ©rfanos de `audits/` contra DB real por schema.
  Riesgo residual:
  - La limpieza automatica de huÃ©rfanos por cron externo aun no esta cableada; se ejecuta manual por comando.
- Fecha: 2026-03-09
  Cambio: Optimizacion fuerte de peso de auditorias en frontend: compresion a `1280x1280` calidad `0.65` y limite de `30` fotos por auditoria.
  Archivos:
  - `src/modules/audits/pages/AuditsPage.tsx`
  Riesgo mitigado:
  - Reduce crecimiento de storage por auditoria y evita cargas extremas por exceso de fotos.
  Riesgo residual:
  - Si operacion requiere evidencia mayor a 30 fotos, se necesita criterio de excepcion o anexos externos.
- Fecha: 2026-03-10
  Cambio: Notificaciones entre usuarios por eventos operativos (alta de nota de pedido externo y alta de reparacion).
  Archivos:
  - `backend/src/services/userNotifications.ts`
  - `backend/src/routes/notifications.ts`
  - `backend/src/routes/externalRequests.ts`
  - `backend/src/routes/repairs.ts`
  - `backend/src/index.ts`
  - `src/core/context/appState.ts`
  - `src/core/context/AppContext.tsx`
  - `src/core/layout/AppLayout.tsx`
  - `src/core/notifications/notifications.ts`
  - `src/modules/system/pages/NotificationsPage.tsx`
  - `src/types/domain.ts`
  Riesgo mitigado:
  - Los usuarios objetivo reciben alertas claras cuando otro usuario crea NDP o reparaciones, con persistencia por usuario en backend.
  Riesgo residual:
  - Destinatarios por defecto acotados a usernames (`Rbottero`, `Galonso`) con fallback a roles de gestion; si cambian usuarios, conviene parametrizar `NOTIFICATION_TARGET_USERNAMES` en entorno.
- Fecha: 2026-03-11
  Cambio: Ajuste de circuito de notificaciones operativas para incluir a Nicolas (`nmasin`) en el grupo por defecto.
  Archivos:
  - `backend/src/services/userNotifications.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Si falta la variable `NOTIFICATION_TARGET_USERNAMES`, el fallback por codigo mantiene el circuito completo entre `nmasin`, `rbottero` y `galonso` (siempre excluyendo al actor).
  Riesgo residual:
  - En produccion sigue siendo recomendable fijar `NOTIFICATION_TARGET_USERNAMES=rbottero,galonso,nmasin` para que cambios futuros de codigo no alteren destinatarios operativos.
- Fecha: 2026-03-11
  Cambio: Upgrade premium del modulo de reportes con tableros analiticos de cumplimiento y performance operativa.
  Archivos:
  - `src/modules/reports/pages/ReportsPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Reportes deja de ser solo exportacion y pasa a incluir KPIs accionables: cumplimiento de tareas, ranking de reparaciones y comparativa proveedor vs proveedor por tiempo/costo/margen.
  Riesgo residual:
  - El indicador "quien realizo mas reparaciones" se infiere por proveedor (`supplierName`), no por usuario mecanico, porque `RepairRecord` aun no persiste autor de carga/resolucion.
- Fecha: 2026-03-11
  Cambio: Hardening de login online con reintento automatico para fallos transitorios (sleep/red/timeout backend).
  Archivos:
  - `src/modules/auth/pages/LoginPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Reduce errores recurrentes de "No se pudo autenticar en el servidor" cuando Render tarda en despertar o hay red inestable al iniciar sesion.
  Riesgo residual:
  - Si backend/API sigue caido de forma sostenida, login online no va a completar; solo mejora la tolerancia a fallos intermitentes.
- Fecha: 2026-03-11
  Cambio: Rediseno visual de "Ocupacion por cliente" en Reportes para mejorar legibilidad operativa.
  Archivos:
  - `src/modules/reports/pages/ReportsPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Elimina listados ilegibles de patentes en bloque, unifica clientes por nombre normalizado y agrega vista top con porcentajes/chips expandibles.
  Riesgo residual:
  - La comparacion por cliente depende de la calidad del dato `clientName`; si operacion carga nombres inconsistentes, conviene gobernanza de catalogo.
- Fecha: 2026-03-11
  Cambio: Hardening de sincronizacion de OT para red inestable (reintentos + refresco automatico en background cada 20s).
  Archivos:
  - `src/core/layout/AppLayout.tsx`
  - `backend/src/routes/workOrders.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Reduce errores intermitentes de `No se pudo sincronizar /work-orders` por timeout/red movil y evita depender de recargar varias veces para ver OT nuevas.
  Riesgo residual:
  - Si backend queda caido de forma sostenida o sin conectividad, la sincronizacion seguira fallando aunque con reintentos y refresco automatico.
- Fecha: 2026-03-11
  Cambio: PDF de OT habilitado aunque existan desvios sin resolver; el bloqueo de cierre se mantiene sin cambios.
  Archivos:
  - `src/modules/workOrders/pages/WorkOrdersPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Permite emitir reporte PDF operativo durante ejecucion de la OT sin forzar cierre anticipado.
  Riesgo residual:
  - Puede circular un PDF con desvios pendientes; el control estricto sigue estando en la accion de cierre de OT.
- Fecha: 2026-03-12
  Cambio: Upgrade profesional del modulo Reparaciones con nuevos campos operativos: fecha, hora, km unidad y moneda (ARS/USD), con persistencia backend.
  Archivos:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260312103000_add_repair_operational_fields/migration.sql`
  - `backend/src/routes/repairs.ts`
  - `src/types/domain.ts`
  - `src/modules/repairs/types.ts`
  - `src/modules/repairs/services/repairsService.ts`
  - `src/modules/repairs/components/RepairsForm.tsx`
  - `src/modules/repairs/components/RepairCostCard.tsx`
  - `src/modules/repairs/components/RepairsHistoryCard.tsx`
  - `src/modules/repairs/pages/RepairsPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Mejora trazabilidad real de cada reparacion (cuando se hizo, con cuantos km y en que moneda) y evita mezclar montos ARS/USD en un total unico.
  Riesgo residual:
  - Requiere aplicar migracion en base de datos para que backend quede alineado con los nuevos campos de `RepairRecord`.
- Fecha: 2026-03-12
  Cambio: Correccion robusta de fecha en Remitos + permisos de edicion/eliminacion solo para roles DEV y GERENTE.
  Archivos:
  - `backend/src/routes/movements.ts`
  - `src/modules/movements/services/movementsService.ts`
  - `src/modules/movements/pages/MovementsPage.tsx`
  - `src/modules/movements/services/movementPdfService.ts`
  - `src/modules/fleet/components/FleetMovementsPanel.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Evita parseos ambiguos de fecha (casos como `dd/mm/yyyy` mal interpretados) y bloquea cambios/eliminaciones de remitos por roles no autorizados.
  Riesgo residual:
  - Si un PDF trae fecha ilegible o fuera de rango operativo, se exigira correccion manual antes de guardar.
- Fecha: 2026-03-12
  Cambio: Hardening de compatibilidad en `/repairs` para evitar "desaparicion" de reparaciones ante desfasaje entre schema Prisma y columnas reales en DB.
  Archivos:
  - `backend/src/routes/repairs.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Si faltan columnas nuevas (`performedAt`, `unitKilometers`, `currency`) en produccion, el backend sigue listando/creando/actualizando reparaciones con fallback legacy en vez de fallar en bloque.
  Riesgo residual:
  - El fallback mantiene operacion, pero se recomienda alinear DB con migraciones para persistir campos nuevos de reparaciones sin modo compatibilidad.
- Fecha: 2026-03-12
  Cambio: Recuperacion cruzada de reparaciones por schema (`enertrans_prod` + `public`) en `GET /repairs`, con merge/dedupe por `id`.
  Archivos:
  - `backend/src/routes/repairs.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Evita que reparaciones "desaparezcan" cuando el backend queda apuntando a un schema distinto al que contiene los datos historicos.
  Riesgo residual:
  - Si hay escrituras repartidas entre schemas, la operacion sigue funcionando por lectura combinada, pero se recomienda unificar `DATABASE_URL` con `schema=enertrans_prod` para eliminar ambiguedad estructural.
- Fecha: 2026-03-12
  Cambio: Correccion de edicion de fecha en remitos existentes (PATCH) con schema de update sin defaults implicitos y parseo de fecha sin recorte artificial por anio.
  Archivos:
  - `backend/src/routes/movements.ts`
  - `src/modules/movements/services/movementsService.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - La fecha ingresada al editar un remito se persiste correctamente y se refleja en PDF/listados sin quedar atada a defaults vacios del schema de edicion.
  Riesgo residual:
  - Remitos historicos con fecha mal cargada previamente requieren edicion puntual para corregir el dato almacenado.
- Fecha: 2026-03-13
  Cambio: Renombre funcional del modulo de auditorias a inspecciones + ajuste de checklist y prefijos de codigo.
  Archivos:
  - `src/modules/audits/services/auditsService.ts`
  - `backend/src/routes/audits.ts`
  - `src/modules/audits/pages/AuditsPage.tsx`
  - `src/modules/audits/services/auditPdfService.ts`
  - `src/modules/audits/components/AuditHistoryList.tsx`
  - `src/core/layout/Sidebar.tsx`
  - `src/modules/fleet/pages/FleetDetailPage.tsx`
  - `src/modules/system/pages/MaintenanceModePage.tsx`
  - `src/modules/users/pages/UsersPage.tsx`
  - `src/core/notifications/notifications.ts`
  - `src/modules/reports/pages/ReportsPage.tsx`
  - `src/modules/dashboard/pages/DashboardPage.tsx`
  - `src/services/offline/sync.ts`
  - `src/modules/workOrders/pages/WorkOrdersPage.tsx`
  - `src/modules/workOrders/components/WorkOrderCard.tsx`
  - `backend/src/routes/users.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Unifica lenguaje operativo (INSPECCIONES) y evita seguir emitiendo nuevos codigos con prefijo legacy `AU/RAU`.
  - Checklist actualizado: en HIDROGRUA se reemplaza por `Extensibles`, en DOCUMENTACION se elimina `Ruta`, y se agrega seccion `ELASTICOS Y AMORTIGUACION`.
  Riesgo residual:
  - Registros historicos existentes conservan sus codigos previos `AU/RAU`; solo las nuevas inspecciones salen con `INS/RINS`.
- Fecha: 2026-03-14
  Cambio: Correccion critica en cierre de OT para permitir completar evidencia fotografica en desvios ya resueltos y evitar bloqueos silenciosos al cerrar.
  Archivos:
  - `src/modules/workOrders/pages/WorkOrdersPage.tsx`
  - `src/modules/workOrders/components/WorkOrderCard.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - El mecanico puede cerrar OT cuando todos los desvios estan realmente resueltos con evidencia, incluyendo casos legacy donde el estado estaba en `RESOLVED` pero faltaba foto.
  - Se agrega feedback explicito de cuantos desvios bloquean el cierre y ejemplos concretos.
  Riesgo residual:
  - OT historicas sin foto siguen requiriendo completar evidencia manual antes de cerrar; no se autocompleta evidencia retroactiva.
- Fecha: 2026-03-14
  Cambio: Incorporacion de 3 modulos operativos nuevos (Clientes, Entregas/Devoluciones, Proveedores) con persistencia backend y sincronizacion global en frontend.
  Archivos:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260314190000_add_clients_suppliers_deliveries/migration.sql`
  - `backend/src/routes/clients.ts`
  - `backend/src/routes/deliveries.ts`
  - `backend/src/routes/suppliers.ts`
  - `backend/src/routes/fleet.ts`
  - `backend/src/routes/repairs.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/index.ts`
  - `src/types/domain.ts`
  - `src/core/context/appState.ts`
  - `src/core/context/AppContext.tsx`
  - `src/core/layout/AppLayout.tsx`
  - `src/core/layout/Sidebar.tsx`
  - `src/core/routing/routePaths.ts`
  - `src/core/routing/AppRouter.tsx`
  - `src/modules/clients/pages/ClientsPage.tsx`
  - `src/modules/deliveries/pages/DeliveriesPage.tsx`
  - `src/modules/suppliers/pages/SuppliersPage.tsx`
  - `src/modules/system/pages/MaintenanceModePage.tsx`
  - `src/modules/repairs/types.ts`
  - `src/modules/repairs/services/repairsService.ts`
  - `src/modules/repairs/components/RepairsForm.tsx`
  - `src/modules/repairs/pages/RepairsPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Mejora asignacion de unidades por cliente sin depender de textos manuales.
  - Agrega estado logistico por unidad para escenarios reales (`PENDIENTE_ENTREGA`, `PENDIENTE_DEVOLUCION`) sin perder el estado tecnico.
  - Estandariza proveedores para evitar dispersion de nombres y mejorar calidad de reportes de reparaciones/costos.
  Riesgo residual:
  - Requiere correr migracion en backend (`prisma migrate deploy`) antes de usar los modulos nuevos en produccion.
  - Reparaciones historicas con proveedor libre permanecen como texto; la normalizacion total de historico puede requerir limpieza adicional.
- Fecha: 2026-03-15
  Cambio: Ficha avanzada de proveedores con datos comerciales/ubicacion y soporte de mapa embebido.
  Archivos:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260315101500_add_supplier_payment_and_location_fields/migration.sql`
  - `backend/src/routes/suppliers.ts`
  - `src/types/domain.ts`
  - `src/core/routing/routePaths.ts`
  - `src/core/routing/AppRouter.tsx`
  - `src/modules/suppliers/pages/SuppliersPage.tsx`
  - `src/modules/suppliers/pages/SupplierDetailPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Se puede registrar por proveedor metodo de pago, plazo, direccion y link de Google Maps.
  - Cada proveedor ahora tiene ficha propia con mapa visible para operacion (sin depender de abrir otro sistema).
  Riesgo residual:
  - Si el link pegado de Google Maps no es publico o no permite embed, el mapa puede no renderizar y queda solo el boton para abrir el link externo.
- Fecha: 2026-03-16
  Cambio: Hardening de proveedores y despliegue backend para evitar 500 por desalineacion de migraciones.
  Archivos:
  - `backend/src/routes/suppliers.ts`
  - `backend/package.json`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - `/suppliers` deja de depender estrictamente de columnas nuevas: si faltan `paymentMethod/paymentTerms/address/mapsUrl`, opera en modo compatibilidad sin romper.
  - `npm start` en backend ahora ejecuta `prisma migrate deploy` antes de levantar servidor, reduciendo riesgo de deploy sin migraciones aplicadas.
  Riesgo residual:
  - Si la DB productiva apunta a schema incorrecto (por ejemplo no `enertrans_prod`), puede seguir habiendo inconsistencias de datos aunque no rompa la ruta de proveedores.
- Fecha: 2026-03-16
  Cambio: Seleccion automatica de schema DB en runtime (`enertrans_prod` vs `public`) para evitar errores `P2021/P2022` por tablas/columnas faltantes.
  Archivos:
  - `backend/src/db.ts`
  - `backend/src/index.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Backend deja de quedar atado ciegamente al schema del `DATABASE_URL`; al iniciar, elige el schema con mejor compatibilidad real para `FleetUnit`, `Supplier`, `ClientAccount` y `DeliveryOperation`.
  - Se eliminan fallos recurrentes en `/fleet`, `/clients`, `/suppliers`, `/deliveries` cuando las migraciones quedaron partidas entre schemas.
  Riesgo residual:
  - Si la informacion quedo realmente dividida entre schemas (datos distintos en ambos), la app trabajara sobre el schema mas consistente detectado; igual conviene unificar schema de produccion en una ventana controlada.
- Fecha: 2026-03-16
  Cambio: Refuerzo del selector de schema para evaluar explicitamente `table_schema` por candidato y permitir override por entorno.
  Archivos:
  - `backend/src/db.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Evita falsos positivos de deteccion por `current_schema()` y mejora la eleccion entre `enertrans_prod/public` cuando una tiene tablas legacy y la otra tablas nuevas.
  - Agrega `DATABASE_SCHEMA_FORCE` para fijar schema en incidentes productivos sin tocar codigo.
  Riesgo residual:
  - Si ambos schemas estan incompletos, se elegira el \"menos malo\" por score; requiere normalizacion definitiva de base para eliminar ambiguedad.
- Fecha: 2026-03-16
  Cambio: Failover automatico de schema en runtime ante errores Prisma `P2021/P2022` y cobertura en endpoints criticos (`/fleet`, `/clients`, `/suppliers`, `/deliveries`).
  Archivos:
  - `backend/src/db.ts`
  - `backend/src/routes/fleet.ts`
  - `backend/src/routes/clients.ts`
  - `backend/src/routes/suppliers.ts`
  - `backend/src/routes/deliveries.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Si una request cae por tabla/columna faltante en schema activo, backend intenta cambiar al schema alternativo y reintenta la operacion en caliente sin tumbar flujo.
  - Reduce errores 500 de sincronizacion global al abrir app cuando hay drift entre `enertrans_prod` y `public`.
  Riesgo residual:
  - Si ninguno de los schemas tiene estructura suficiente, el failover no puede recuperar y la request mantiene error; requiere correccion estructural de DB.
- Fecha: 2026-03-16
  Cambio: Auto-reparacion de schema en bootstrap backend para tablas/columnas criticas de modulos nuevos (Clientes, Proveedores, Entregas/Devoluciones y columnas logisticas en FleetUnit).
  Archivos:
  - `backend/src/db.ts`
  - `backend/src/index.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Incluso si Render arranca solo con `node dist/src/index.js` y sin ejecutar `migrate deploy`, backend crea/ajusta estructura minima necesaria para evitar 500 en `/fleet`, `/clients`, `/suppliers`, `/deliveries`.
  Riesgo residual:
  - La auto-reparacion prioriza continuidad operativa y compatibilidad; no reemplaza una normalizacion completa de migraciones en una ventana de mantenimiento.
- Fecha: 2026-03-16
  Cambio: Ajuste final de failover DB para evitar cambio a schema incompatible por diferencia de mayusculas/minusculas en nombres de tablas.
  Archivos:
  - `backend/src/db.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - El probe ahora valida nombres exactos de Prisma (`FleetUnit`, `Supplier`, `ClientAccount`, `DeliveryOperation`, `clientId`), evitando elegir schemas con tablas legacy en lowercase que Prisma no puede consultar.
  - Ante `P2021/P2022`, se intenta primero auto-reparar el schema activo y reintentar antes de cambiar de schema.
  Riesgo residual:
  - Si el usuario DB no tiene permisos DDL (CREATE/ALTER), la auto-reparacion no podra completar estructura faltante y se debera correr migracion con credenciales owner.
- Fecha: 2026-03-16
  Cambio: Endurecimiento del selector/failover DB con criterio de \"core schema\" obligatorio (`User`, `FleetUnit`, `RepairRecord`).
  Archivos:
  - `backend/src/db.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Evita seleccionar/failover a schemas parciales (ej. solo `Supplier/ClientAccount/DeliveryOperation`) que dejan el backend sin tablas base y rompen bootstrap/login.
  Riesgo residual:
  - Si el schema activo base carece de columnas nuevas, la app depende de auto-reparacion DDL o de migraciones manuales para completar estructura.
- Fecha: 2026-03-16
  Cambio: Degradacion controlada para endpoints de sincronizacion global ante drift severo de schema (sin 500 en `GET /fleet`, `GET /clients`, `GET /suppliers`, `GET /deliveries`).
  Archivos:
  - `backend/src/routes/fleet.ts`
  - `backend/src/routes/clients.ts`
  - `backend/src/routes/suppliers.ts`
  - `backend/src/routes/deliveries.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Evita cortar operacion por errores Prisma `P2021/P2022`: retorna datos legacy o listas vacias en vez de 500 y elimina alertas de sincronizacion global bloqueantes.
  - En proveedores agrega fallback persistente en `AppSettings.featureFlags.suppliersFallback` para altas/ediciones mientras la tabla `Supplier` no exista.
  Riesgo residual:
  - El fallback de proveedores no reemplaza la tabla definitiva; cuando se normalice DB se recomienda migrar `suppliersFallback` a `Supplier`.
- Fecha: 2026-03-16
  Cambio: Lectura de flota en modo compatibilidad hard cuando falta `FleetUnit.clientId`.
  Archivos:
  - `backend/src/routes/fleet.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - `GET /fleet` y `GET /fleet/:id` ya no dependen de Prisma si la columna `clientId` no existe; consultan con SQL legacy y normalizan salida para frontend.
  Riesgo residual:
  - Mientras siga faltando `clientId`, operaciones de escritura de flota que usen ese campo pueden mantener limitaciones hasta normalizar schema.
- Fecha: 2026-03-17
  Cambio: Endurecimiento del modulo Entregas/Devoluciones con flujo operativo Enertrans, selector por dominio, adjunto de remito post-operacion y PDF operativo por evento.
  Archivos:
  - `src/modules/deliveries/pages/DeliveriesPage.tsx`
  - `src/modules/deliveries/services/deliveryPdfService.ts`
  - `src/types/domain.ts`
  - `backend/src/routes/deliveries.ts`
  - `backend/src/db.ts`
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260317120000_add_delivery_remito_attachment/migration.sql`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - El operador selecciona unidad escribiendo dominio y evita errores por listas largas.
  - Se elimina ambiguedad de `Sin cambio de cliente` y se explicita el comportamiento de cliente en entrega/devolucion.
  - Se bloquean transiciones logisticas inconsistentes y se valida flujo real: disponible > pendiente de entrega > entregado > pendiente de devolucion > devuelto.
  - Se permite adjuntar/reemplazar remito en operaciones finales (entregado/devuelto) y queda trazabilidad de quien lo adjunto.
  - Se agrega generacion de informe PDF por operacion con template Enertrans para envio al cliente.
  Riesgo residual:
  - El PDF operativo es descargable localmente; no se persiste automaticamente como archivo historico en backend salvo que el usuario lo adjunte manualmente.
  - El control de flujo depende de estados logisticos cargados correctamente en cada unidad; datos legacy inconsistentes pueden requerir normalizacion puntual.
- Fecha: 2026-03-17
  Cambio: Hotfix NDP externo para evitar reaparicion de notas eliminadas y mejora UX de seleccion de unidad por dominio.
  Archivos:
  - `src/modules/externalRequests/pages/ExternalRequestsPage.tsx`
  - `src/services/offline/sync.ts`
  - `src/core/layout/AppLayout.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Eliminar una nota externa ahora elimina en backend cuando hay conexion y, si estaba pendiente en cola local, cancela esa cola para que no se recree luego.
  - En modo offline, la eliminacion se encola (`externalRequest.delete`) para aplicarse al volver la red.
  - La sincronizacion global deja de reinyectar \"fantasmas\" de NDP desde cache local y prioriza remoto + pendientes reales en cola.
  - Formulario NDP ahora permite buscar unidad escribiendo dominio/patente y limpiar realmente el input de archivo.
  Riesgo residual:
  - Si una nota ya fue eliminada manualmente en backend y existe una cola delete vieja, puede devolverse 404 en sync (se descarta por politica no reintetable).
- Fecha: 2026-03-17
  Cambio: Ajuste UX NDP para usar solo campo libre de dominio (sin desplegable de patentes) y validacion por coincidencia exacta.
  Archivos:
  - `src/modules/externalRequests/pages/ExternalRequestsPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Se elimina ruido visual y scroll innecesario en flotas grandes; operador escribe patente directa.
  Riesgo residual:
  - Si escriben dominio incompleto o con error de formato, la nota no se crea hasta ingresar coincidencia exacta.
- Fecha: 2026-03-19
  Cambio: Hotfix critico de compatibilidad DB para NDP y reparaciones en runtime (schema drift en Render).
  Archivos:
  - `backend/src/db.ts`
  - `backend/src/routes/externalRequests.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - `ensureRuntimeSchemaCompatibility` deja de ejecutar SQL contra tablas/columnas inexistentes (`RepairRecord`, `providerFileUrl`) y elimina cascada de warnings `P2010`.
  - `GET /external-requests` ahora recupera datos en modo legacy por schema/columnas disponibles (sin asumir `companyName`, `currency`, `providerFileUrl`) evitando 500 y perdida de visibilidad de NDP historicas.
  - Si un schema parcial falla, se ignora solo ese schema y no se cae toda la recuperacion.
  Riesgo residual:
  - Si existe un schema extremadamente viejo sin columnas minimas (`id`, `code`, `unitId`, `createdAt`) se omite por seguridad y no entra al listado.
- Fecha: 2026-03-21
  Cambio: Alta del modulo CRM Comercial (pipeline + actividades) con permisos y feature flag.
  Archivos:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260321153000_add_crm_module/migration.sql`
  - `backend/src/routes/crm.ts`
  - `backend/src/index.ts`
  - `backend/src/routes/settings.ts`
  - `backend/src/auth/permissions.ts`
  - `backend/src/db.ts`
  - `src/modules/crm/pages/CrmPage.tsx`
  - `src/core/routing/AppRouter.tsx`
  - `src/core/routing/routePaths.ts`
  - `src/core/layout/Sidebar.tsx`
  - `src/modules/system/pages/MaintenanceModePage.tsx`
  - `src/core/auth/permissions.ts`
  - `src/types/domain.ts`
  - `src/core/context/appState.ts`
  - `src/modules/users/pages/UsersPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Nuevo circuito comercial desacoplado del flujo operativo (sin tocar OT/auditorias/reparaciones existentes).
  - Activacion controlada por flag `showCrmModule` y permisos por modulo `CRM`.
  - Compatibilidad runtime en backend para crear tipos/tablas CRM en schema activo y evitar 500 por drift en despliegues sin migracion.
  Riesgo residual:
  - Primera version no incluye automatizaciones cross-modulo (ej. convertir oportunidad ganada en cliente/unidad de forma automatica).
  - Pipeline no usa drag-and-drop todavia; el cambio de etapa se realiza por selector.
- Fecha: 2026-03-21
  Cambio: Cierre CRM v2 (pipeline interactivo + conversion de oportunidad a cliente + trazabilidad automatica de etapa).
  Archivos:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260321170000_add_crm_deal_client_conversion/migration.sql`
  - `backend/src/db.ts`
  - `backend/src/routes/crm.ts`
  - `src/modules/crm/pages/CrmPage.tsx`
  - `src/types/domain.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Pipeline CRM ahora soporta drag-and-drop por etapas y fallback por selector/boton, reduciendo friccion operativa del equipo comercial.
  - Cada cambio de etapa genera actividad automatica, mejorando auditoria interna del ciclo comercial.
  - Oportunidades ganadas pueden convertirse y vincularse a `ClientAccount` con endpoint dedicado, evitando doble carga manual en modulo Clientes.
  - Compatibilidad runtime y migracion agregan `convertedClientId` sin romper registros legacy.
  Riesgo residual:
  - KPI monetarios del CRM se muestran en ARS por simplicidad visual; no hay conversion multi-moneda para consolidado global.
  - Conversion a cliente no genera todavia alta automatica de unidad/contrato ni workflows comerciales avanzados (seguimiento por SLA/recordatorios push).
- Fecha: 2026-03-21
  Cambio: Cierre funcional final de CRM Comercial (UX profesional de punta a punta) antes de deploy.
  Archivos:
  - `backend/src/routes/crm.ts`
  - `src/modules/crm/pages/CrmPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Se completa flujo operativo en una sola pantalla: alta + pipeline + detalle editable + agenda de actividades + conversion a cliente + eliminacion con confirmacion.
  - Se corrige consistencia de auditoria interna del CRM: los cambios de etapa y conversion quedan atribuidos al usuario actor.
  - Se habilita manejo explicito de oportunidades perdidas (`lostReason`) tanto en alta como en edicion.
  Riesgo residual:
  - Actividades CRM no tienen aun recordatorios push/email automáticos.
  - No hay panel historico de cambios por campo (solo actividades y cambios de etapa).
- Fecha: 2026-03-21
  Cambio: CRM Comercial v3 con concursos/contratos por unidad y carga historica manual uno-a-uno.
  Archivos:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260322001000_add_crm_deal_units_and_kind/migration.sql`
  - `backend/src/db.ts`
  - `backend/src/routes/crm.ts`
  - `backend/src/routes/fleet.ts`
  - `src/modules/crm/pages/CrmPage.tsx`
  - `src/modules/fleet/components/FleetUnitCard.tsx`
  - `src/types/domain.ts`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Se incorpora tipologia de oportunidad (`Concurso`/`Contrato`) con referencia comercial y bandera `Historico` para cargar cartera antigua manualmente sin imports masivos.
  - Se habilita vinculacion de multiples unidades por oportunidad con estados operativos (`En concurso`, `Adjudicada`, `Perdida`, `Liberada`) y bloqueo de doble asignacion activa de una misma unidad.
  - El detalle CRM permite buscar dominio, vincular/quitar unidades y actualizar estado por unidad, dejando trazabilidad de actividades del actor.
  - Se expone visibilidad comercial en Flota (`crmDealLink`) para que operaciones vea unidades comprometidas comercialmente.
  - Compatibilidad runtime en backend/migracion para evitar 500 por drift al agregar tablas/enums nuevos del CRM.
  Riesgo residual:
  - Carga historica sigue siendo manual registro por registro (sin importador por lote).
  - No existe todavia forecast avanzado por disponibilidad futura ni scoring de conflictos por fechas de contrato.
- Fecha: 2026-03-21
  Cambio: Ajuste UX CRM para recuperar layout profesional previo y mezclarlo con funciones nuevas de concursos/contratos.
  Archivos:
  - `src/modules/crm/pages/CrmPage.tsx`
  - `PROJECT_CONTEXT.md`
  Riesgo mitigado:
  - Se restablece pantalla completa de CRM (pipeline + detalle + actividades) evitando quedar en un flujo reducido de solo alta.
  - Se integran en ese mismo formato los campos nuevos (`dealKind`, `referenceCode`, `isHistorical`) y el panel de unidades vinculadas por oportunidad.
  - Se mantiene continuidad operativa comercial con edición de oportunidades, cambio de etapa, conversión a cliente y gestión de unidades en un único módulo.
  Riesgo residual:
  - La búsqueda de unidades para vincular sigue siendo por texto/manual; no hay autocompletado incremental en tiempo real.

## 9) Riesgos abiertos (a seguir)

- Falta pipeline CI formal de tests (el runner local ya existe).
- Bundle principal supera warning de chunk size (>500KB).

## 10) Regla de mantenimiento de este archivo

Desde ahora, en cada cambio relevante se debe actualizar este archivo en el mismo PR/commit:
- Seccion impactada (`arquitectura`, `offline`, `timeline`, `riesgos`).
- Fecha de actualizacion.
- Resumen de impacto funcional y operativo.

Plantilla minima para cada update:
- Fecha:
- Cambio:
- Archivos:
- Riesgo mitigado:
- Riesgo residual:

