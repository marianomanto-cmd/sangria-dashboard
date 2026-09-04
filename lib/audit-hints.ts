// ════════════════════════════════════════════════════════════════════════════
// Qué explica cada control desactivado en modo auditoría.
//
// La clave es el nombre de la server action que dispara el control, tal cual
// se exporta en `app/actions/*.ts`. En la UI se marca así:
//
//     <Button data-audit-hint="approvePlan">Aprobar</Button>
//
// Y `components/audit-mode.tsx` levanta la entrada de acá y la muestra en un
// cuadrito al pasar el mouse.
//
// ── Cómo escribir una entrada ───────────────────────────────────────────────
// El público es una auditora externa que NO conoce el código. Entonces:
//   • `title`: el cambio, en una línea, con verbo en presente.
//   • `what`: qué pasa exactamente al confirmarlo, en criollo. Si el cambio es
//     irreversible o congela algo, decilo acá — es lo primero que una
//     auditoría quiere saber.
//   • `affects`: las áreas de la app y los números que se mueven en
//     consecuencia. Concreto: "Facturación del plan", "Portal del cliente",
//     no "varias vistas".
//
// Un control marcado sin entrada acá cae en GENERIC_AUDIT_HINT: se sigue
// bloqueando y se sigue explicando, sólo que en genérico.
//
// Este archivo es data pura (lo importa un client component): nada de
// imports server-only.
// ════════════════════════════════════════════════════════════════════════════

export type AuditHint = {
  title: string;
  what: string;
  affects: string[];
};

export const GENERIC_AUDIT_HINT: AuditHint = {
  title: "Este control haría un cambio",
  what: "En la vista de auditoría no se aplica ningún cambio: la sesión es de solo lectura y el servidor rechaza cualquier escritura.",
  affects: [],
};

// Las entradas se generaron leyendo una por una las 73 server actions que
// escriben, y después se corrigen a mano acá. Están ordenadas alfabéticamente
// y comentadas con el archivo de origen.
export const AUDIT_HINTS: Record<string, AuditHint> = {
  // plans.ts
  addFee: {
    title: "Agrega un fee al plan: management por porcentaje sobre la media, o setup/reporting/custom por monto fijo",
    what: "",
    affects: [
      "Total facturable del plan",
      "Estimación y billing mensual",
      "Excel y PDF del plan",
      "Portal del cliente",
    ],
  },
  // plans.ts
  addPlacement: {
    title: "Agrega una línea (placement) dentro de un bloque de publisher, con su nombre, mercado y monto",
    what: "",
    affects: [
      "Detalle del plan y su Excel/PDF",
      "Prorrateo mensual de la inversión",
      "Estimación de facturación",
      "Análisis por mercado",
    ],
  },
  // plans.ts
  addPublisherToPlan: {
    title: "Suma un bloque de publisher al plan con su presupuesto planificado",
    what: "No se puede si el plan está archivado.",
    affects: [
      "Detalle del plan y su Excel/PDF",
      "Total de media del plan",
      "Estimación de facturación",
      "Análisis por publisher",
    ],
  },
  // report-comments.ts
  addReportComment: {
    title: "Agrega un comentario nuevo al reporte y lo firma con el mail de quien está logueado",
    what: "Si no hay sesión abierta, lo guarda igual pero sin autor. Antes chequea que el reporte exista y que el texto no esté vacío ni pase los 4000 caracteres.",
    affects: [
      "Modal de comentarios del reporte",
      "Contador de comentarios visible en el calendario de reportes",
      "Listado de reportes enviados",
      "Audit log: queda registrado quién comentó, qué escribió y cuándo",
    ],
  },
  // app-users.ts
  addUserByEmail: {
    title: "Deja precargada a una persona por email con un rol ya asignado, para que cuando entre por primera vez tenga esos permisos",
    what: "No crea la cuenta ni manda invitación: la identidad la sigue dando el login.",
    affects: [
      "Quién pasa a formar parte del equipo con acceso a la app",
      "Los permisos que va a tener al entrar, incluida la posibilidad de aprobar planes si se le da ese rol",
      "Pantalla de Configuración → Usuarios y roles",
      "Queda registrado en el audit log como alta de usuario",
    ],
  },
  // plans.ts
  bulkUpdatePlacementDates: {
    title: "Mueve de una sola pasada las fechas de inicio y/o fin de TODAS las líneas del plan",
    what: "Sólo se permite si el plan está en borrador y nunca deja un rango dado vuelta.",
    affects: [
      "Fechas de todas las líneas del plan",
      "Prorrateo mensual, pacing y campaign tracker",
      "Estimación de facturación",
      "Excel/PDF del plan y portal del cliente",
    ],
  },
  // plan-billing.ts
  clearBillingInvoiceNumber: {
    title: "Borra el número de factura de un mes y lo devuelve al estado anterior (reportado a finanzas)",
    what: "Solo se puede si el mes está facturado y todavía no pagado; la fecha de vencimiento queda como historial.",
    affects: [
      "Número de factura del mes y su estado",
      "Portal del cliente (la factura deja de figurar)",
      "Cobranzas y dashboard de facturación",
      "Audit log",
    ],
  },
  // campaign-tracker.ts
  closeDailyLoad: {
    title: "Cierra la carga del día",
    what: "Saca una foto de todo lo cargado hoy en el plan y la archiva con la fecha de hoy, incluyendo las métricas que están en cero y el objetivo planeado de cada una. Si el día ya se había cerrado, la foto anterior se pisa con la nueva.",
    affects: [
      "Histórico de consumo del plan, que es la base de las curvas de evolución y del pacing día a día",
      "Reportes y exports que se arman sobre ese histórico: lo que se cierre hoy es lo que va a mostrar el reporte",
      "Dashboard y vistas del Campaign Tracker, que se refrescan con la foto recién cerrada",
      "Queda registrado en el audit log el cierre, con la fecha y cuántas filas se archivaron",
    ],
  },
  // plan-qa.ts
  completePlanQa: {
    title: "Cierra el QA de la versión vigente",
    what: "Exige que estén tildadas TODAS las líneas y pasa el plan de «aprobado» a «QA realizado», que es el paso obligatorio para después poder marcarlo live.",
    affects: [
      "Estado del plan: habilita marcarlo Live",
      "Tablero de planes (KPIs Vigentes y Esperando QA)",
      "Ficha del proyecto y detalle del plan",
      "Audit log (queda registrado con notas y usuario)",
    ],
  },
  // plan-planning-qa.ts
  completePlanningQa: {
    title: "Cierra el control de planificación con todas las líneas tildadas y, en el mismo paso, pasa el plan de borrador a Listo para enviar",
    what: "Si el pase se rechaza, deshace el cierre y el plan queda como estaba.",
    affects: [
      "Estado del plan: deja de ser editable y queda listo para mandar a firma",
      "Historial de edición del plan (queda asentado el cambio de estado)",
      "Vistas de proyecto, dashboard, tracker y análisis",
      "Estimación de facturación (el plan ya cuenta como comprometido)",
    ],
  },
  // aux-sheets.ts
  createAuxSheet: {
    title: "Agrega una hoja auxiliar nueva y vacía dentro de un plan de medios, con nombre automático («Auxiliar», «Auxiliar 2», …) y ubicada…",
    what: "…al final del orden de tabs",
    affects: [
      "Detalle del plan: aparece un tab auxiliar nuevo, editable como una planilla",
      "Excel del plan: se suma una hoja más al archivo que se descarga",
      "PDF del plan que se manda a firmar al cliente: se agrega una página nueva por cada hoja auxiliar",
      "Portal del cliente: cambia lo que el cliente se baja al descargar el plan en Excel o PDF",
      "Audit log: queda registrada la creación con el usuario que la hizo",
    ],
  },
  // budget-origins.ts
  createBudgetOrigin: {
    title: "Da de alta un nuevo origen de presupuesto para un cliente (con su nombre y color), que a partir de ahí queda disponible para…",
    what: "…asignárselo a los proyectos",
    affects: [
      "Alta y edición de proyectos (aparece como opción nueva)",
      "Listado de proyectos y de planes",
      "Ficha del cliente en Configuración",
      "Filtros y cortes por origen de presupuesto en Billing, Análisis y Campaign tracker",
      "Audit log (queda registrado quién lo creó)",
    ],
  },
  // clients.ts
  createClient: {
    title: "Da de alta un cliente nuevo (nombre, slug, prefijo de campañas, idioma y estado)",
    what: "El slug que queda es la dirección con la que ese cliente entra al portal.",
    affects: [
      "Configuración › Clientes y el selector de cliente del topbar",
      "Portal del cliente: el slug pasa a ser su URL de acceso",
      "Idioma con el que van a salir sus PDF y Excels (por defecto, inglés)",
      "Audit log: queda registrada el alta con el usuario que la hizo",
    ],
  },
  // creative-billing.ts
  createCreativeBilling: {
    title: "Da de alta una factura nueva de trabajo creativo para un cliente activo, con número de factura único, mes, monto en dólares y…",
    what: "…estado inicial (facturada o ya cobrada)",
    affects: [
      "Pantalla interna de Creative: aparece una fila nueva en la tabla y se recalculan el gráfico mensual y el contador de facturas",
      "Tab Creative del portal del cliente: el cliente pasa a ver esa factura y, si queda como facturada, un botón para marcarla pagada",
      "Plata: suma al total facturado de creative y a lo pendiente de cobro (o directo a cobrado si nace paga)",
      "Audit log: queda asentada el alta completa de la factura",
    ],
  },
  // reports.ts
  createManualReport: {
    title: "Crea un reporte ad-hoc para un cliente (nombre, descripción y fecha de entrega), sin necesidad de que haya un proyecto cerrado…",
    what: "…detrás. La descripción se copia además como primer comentario del tablero de ese reporte, firmada por quien lo creó",
    affects: [
      "Calendario de reportes: aparece una fila nueva en el Gantt con su compromiso de fecha",
      "Pendientes del dashboard",
      "Tablero de comentarios del reporte (queda el primer comentario con autor y email)",
      "Audit log: registra la creación con todos los datos",
    ],
  },
  // markets.ts
  createMarket: {
    title: "Da de alta un mercado nuevo en el catálogo del cliente (por ejemplo «Costa Rica» o «Centroamérica»), con el nombre armado…",
    what: "…automáticamente a partir del país y el nivel elegidos, y lo deja habilitado y último en el orden de la lista",
    affects: [
      "Catálogo de mercados en Configuración",
      "Selector de mercado al armar y editar planes de medios",
      "Mapa y agrupaciones del tab de Análisis",
      "Portal del cliente y su Excel de análisis (hoja Por mercado)",
      "Queda registrado en el audit log",
    ],
  },
  // metrics.ts
  createMetric: {
    title: "Da de alta una métrica nueva para un cliente (por ejemplo Impresiones, CTR o una calculada con fórmula), la deja habilitada y la…",
    what: "…agrega al final del orden del catálogo de ese cliente",
    affects: [
      "Configuración del cliente y pantalla de métricas",
      "Editor de planes de medios: aparece una columna/métrica nueva para cargar",
      "Campaign tracker y el pacing que se calcula con esas métricas",
      "Queda registrada en el audit log con quién la creó",
    ],
  },
  // plans.ts
  createPlan: {
    title: "Crea un plan de medios nuevo y vacío dentro de un proyecto, en estado borrador",
    what: "Rechaza el nombre si ya hay otro plan vivo igual en ese proyecto.",
    affects: [
      "Listado de planes del proyecto",
      "Dashboard y KPIs",
      "Estimación de facturación",
      "Audit log (queda registrado)",
    ],
  },
  // projects.ts
  createProject: {
    title: "Da de alta un proyecto nuevo para un cliente, con su presupuesto bruto, fecha de arranque y carpeta de Drive, y le genera un código interno único",
    what: "",
    affects: [
      "Listado de proyectos",
      "Dashboard de KPIs y totales mensuales",
      "Estimación de facturación",
      "Audit log",
    ],
  },
  // publishers.ts
  createPublisher: {
    title: "Da de alta un medio nuevo en la lista de un cliente, lo deja habilitado, lo pone último en el orden y define si lo paga la…",
    what: "…agencia o lo paga el cliente",
    affects: [
      "Configuración del cliente (lista de publishers)",
      "Armado de planes de medios: el medio nuevo aparece como opción",
      "Estimación de facturación: según si la agencia paga o no, el medio suma o no a lo facturable",
      "Portal del cliente y reportes/Excel donde se abre el gasto por medio",
      "Audit log (queda registrado quién lo creó)",
    ],
  },
  // simulator.ts
  createScenario: {
    title: "Crea un escenario de simulación nuevo para un cliente, con el nombre y las filas de inversión que le manden (arranca vacío si no le pasan filas)",
    what: "",
    affects: [
      "Simulador de escenarios",
      "Listado de escenarios del cliente",
      "Base para después promover el escenario a un plan real",
      "Audit log: no deja ningún rastro",
    ],
  },
  // aux-sheets.ts
  deleteAuxSheet: {
    title: "Borra una hoja auxiliar del plan de forma definitiva",
    what: "No va a la papelera y no se puede recuperar desde la app (solo queda la copia del contenido en el registro de auditoría).",
    affects: [
      "Detalle del plan: desaparece el tab y todo lo que había cargado ahí",
      "Excel del plan: el archivo deja de traer esa hoja",
      "PDF del plan que firma el cliente: se cae la página correspondiente a esa hoja",
      "Portal del cliente: el cliente pasa a descargar un plan sin ese anexo",
      "Audit log: queda registrado el borrado con una copia del contenido previo",
    ],
  },
  // budget-origins.ts
  deleteBudgetOrigin: {
    title: "Borra definitivamente un origen de presupuesto, pero solo si ningún proyecto lo está usando",
    what: "Si hay aunque sea uno, corta y avisa en vez de borrar.",
    affects: [
      "Ficha del cliente en Configuración (desaparece de la lista)",
      "Alta y edición de proyectos (deja de ofrecerse como opción)",
      "Filtros por origen de presupuesto en Billing, Análisis, Campaign tracker y portal del cliente",
      "Audit log (queda el registro del borrado con los datos que tenía)",
    ],
  },
  // reports.ts
  deleteManualReport: {
    title: "Borra un reporte ad-hoc de forma definitiva, junto con todos los comentarios que tenga colgados",
    what: "No hay papelera ni forma de deshacerlo desde la app: lo único que queda es la copia del reporte guardada en la auditoría.",
    affects: [
      "Calendario de reportes: desaparece la fila y el compromiso de entrega con el cliente",
      "Pendientes del dashboard",
      "Tablero de comentarios: se pierde toda la conversación del reporte",
      "Audit log: guarda el contenido completo de lo borrado",
    ],
  },
  // markets.ts
  deleteMarket: {
    title: "Borra un mercado del catálogo del cliente de forma definitiva",
    what: "Las líneas de plan y las filas de seguimiento de campaña que lo tenían asignado no se borran, pero quedan sin mercado.",
    affects: [
      "Líneas de planes de medios (incluidos planes aprobados) que quedan como «Sin mercado»",
      "Seguimiento de campañas y su pacing por mercado, que pierde la atribución geográfica",
      "Tab de Análisis: el mercado desaparece del mapa y la plata se corre a «Sin mercado»",
      "Excel de análisis del portal del cliente, hoja Por mercado",
      "Catálogo de mercados y desplegables de planificación",
      "Queda registrado en el audit log con el estado previo",
    ],
  },
  // metrics.ts
  deleteMetric: {
    title: "Borra definitivamente una métrica del catálogo del cliente",
    what: "No se archiva ni se desactiva, desaparece de la lista y ya no se puede volver a elegir.",
    affects: [
      "Editor de planes: deja de estar disponible para cargarla en placements nuevos",
      "Campaign tracker y pacing: los datos ya cargados con esa métrica quedan sin nombre de catálogo y caen al slug crudo",
      "Reportes históricos y exports a Excel/PDF donde esa columna deja de figurar con su nombre y unidad",
      "Queda registrada en el audit log con la foto de lo borrado",
    ],
  },
  // plans.ts
  deletePlan: {
    title: "Manda el plan a la papelera",
    what: "Desaparece de las vistas y de los números, pero no se borra nada y se puede restaurar después.",
    affects: [
      "Listado de planes del proyecto",
      "Papelera de planes",
      "Estimación de facturación y dashboard",
      "Audit log (queda registrado)",
    ],
  },
  // projects.ts
  deleteProject: {
    title: "Borra el proyecto entero y, por cascada, se lleva puesto todo lo que colgaba de él",
    what: "Planes y sus versiones, publishers, placements, fees, facturación y reportes.",
    affects: [
      "Planes de medios y su historial de versiones",
      "Facturación, billing tracker y estimación",
      "Calendario y reportes del proyecto",
      "Portal del cliente y audit log",
    ],
  },
  // publishers.ts
  deletePublisher: {
    title: "Borra definitivamente un medio del catálogo del cliente",
    what: "Si ya está usado en algún plan, billing o snapshot la base lo frena y avisa que hay que deshabilitarlo en vez de borrarlo.",
    affects: [
      "Configuración del cliente (el medio desaparece de la lista)",
      "Armado de planes de medios: deja de estar disponible",
      "Reportes, benchmarks y exports Excel/PDF donde figuraba ese medio",
      "Portal del cliente: desaparece del desglose por medio",
      "Audit log (queda el registro del borrado con el estado previo)",
    ],
  },
  // report-comments.ts
  deleteReportComment: {
    title: "Borra el comentario de forma definitiva",
    what: "No hay papelera ni deshacer, y el texto sólo sobrevive en el registro de auditoría. Si el comentario ya no existe, contesta que salió todo bien igual.",
    affects: [
      "Modal de comentarios del reporte",
      "Contador de comentarios del calendario de reportes, que baja en uno",
      "Listado de reportes enviados",
      "Audit log: queda registrado quién borró y qué decía el comentario",
    ],
  },
  // simulator.ts
  deleteScenario: {
    title: "Borra el escenario en forma definitiva",
    what: "Se elimina la fila de la base, no se archiva ni se marca como borrado, y desde la app no hay manera de recuperarlo.",
    affects: [
      "Simulador de escenarios",
      "Escenarios guardados del cliente (se pierden sin respaldo)",
      "Comparaciones armadas sobre ese escenario",
      "Audit log: no deja ningún rastro",
    ],
  },
  // plans.ts
  duplicatePlacement: {
    title: "Clona una línea dentro del mismo bloque de publisher y la deja justo debajo de la original, con el mismo monto y fechas",
    what: "",
    affects: [
      "Detalle del plan y su Excel/PDF",
      "Total invertido del bloque",
      "Estimación de facturación",
      "Prorrateo mensual",
    ],
  },
  // plans.ts
  duplicatePlan: {
    title: "Copia un plan entero —publishers, líneas y fees— a un proyecto del mismo cliente con nombre nuevo",
    what: "La copia arranca en borrador y sin versiones aprobadas.",
    affects: [
      "Listado de planes del proyecto destino",
      "Estimación de facturación",
      "Dashboard y campaign tracker",
      "Audit log (queda registrado)",
    ],
  },
  // plans.ts
  duplicatePlanPublisher: {
    title: "Clona un bloque de publisher con todas sus líneas y lo deja justo debajo del original, duplicando también su presupuesto",
    what: "",
    affects: [
      "Detalle del plan y su Excel/PDF",
      "Total de media del plan",
      "Estimación de facturación",
      "Análisis por publisher",
    ],
  },
  // simulator.ts
  duplicateScenario: {
    title: "Copia un escenario existente en uno nuevo, con las mismas filas y el nombre terminado en (copia)",
    what: "El original queda intacto.",
    affects: [
      "Simulador de escenarios",
      "Listado de escenarios del cliente",
      "El escenario copiado hereda el cliente del original, sin chequear si quien copia puede verlo",
      "Audit log: no deja ningún rastro",
    ],
  },
  // plan-billing.ts
  ensureBillingForMonth: {
    title: "Abre la facturación de un mes para un plan",
    what: "Crea la planilla del mes en borrador y deja precargados en cero todos los medios del plan y todos los fees, listos para que la analista complete el consumo real.",
    affects: [
      "Pantalla de facturación del plan",
      "Listado general de facturación",
      "Estimación y pacing del proyecto",
      "Audit log",
    ],
  },
  // reports.ts
  ensureProjectReport: {
    title: "Abre la ficha de reporte final de un proyecto si todavía no existe (si ya está, no toca nada)",
    what: "Es lo que hace que el proyecto aparezca como pendiente en el calendario de reportes. Ojo: esta operación no deja rastro en el audit log ni refresca las vistas por su cuenta.",
    affects: [
      "Calendario de reportes (lista de pendientes de asignar fecha)",
      "Pendientes del dashboard",
      "Historial de reportes del proyecto",
    ],
  },
  // plans.ts
  hardDeletePlan: {
    title: "Borra el plan para siempre desde la papelera, y con él sus publishers, líneas, fees, versiones aprobadas y la facturación cargada",
    what: "No tiene vuelta atrás.",
    affects: [
      "Papelera de planes",
      "Historial de versiones aprobadas del plan",
      "Facturación e imputaciones del plan",
      "Audit log (queda registrado)",
    ],
  },
  // plan-billing.ts
  markBillingInvoiced: {
    title: "Carga el número de factura que devolvió finanzas, pasa el mes a facturado y le pone vencimiento (por defecto a 30 días)",
    what: "Si el mes ya estaba facturado o pagado, solo corrige el número. Rechaza un número de factura ya usado en otro mes.",
    affects: [
      "Número de factura y vencimiento del mes",
      "Portal del cliente (factura visible y su vencimiento)",
      "Cobranzas, vencimientos y dashboard de facturación",
      "Audit log",
    ],
  },
  // reports.ts
  markReportDelivered: {
    title: "Da el reporte por entregado con fecha y hora, y si es el reporte de un proyecto además lo pasa a 'reportado', que es el estado…",
    what: "…final: desde la app ya no se puede volver atrás ni cargarle planes nuevos. Exige tener fecha de entrega asignada antes",
    affects: [
      "Calendario de reportes: sale del Gantt y pasa a la lista de reportes enviados",
      "Estado del proyecto, que queda cerrado de forma definitiva e irreversible",
      "Portal del cliente y simulador: el proyecto deja de figurar como abierto y no admite planes nuevos",
      "Audit log: quedan dos registros, la entrega y el cambio de estado",
    ],
  },
  // simulator.ts
  promoteScenarioToPlan: {
    title: "Convierte el escenario en un plan de medios real dentro de un proyecto",
    what: "Crea el plan en estado borrador, agrupa las filas por publisher y carga cada placement con su presupuesto y sus métricas estimadas.",
    affects: [
      "Vista del proyecto y su listado de planes",
      "Estimación de facturación y pacing del proyecto",
      "Portal del cliente, donde aparece un plan nuevo",
      "Audit log: sí queda registrada el alta del plan y la de cada publisher",
    ],
  },
  // plans.ts
  removeFee: {
    title: "Elimina un fee del plan; se bloquea si ese fee ya tiene plata imputada en algún mes de facturación (avisa en qué meses y por cuánto)",
    what: "",
    affects: [
      "Total facturable del plan",
      "Billing mensual del plan",
      "Excel y PDF del plan",
      "Portal del cliente",
    ],
  },
  // plans.ts
  removePlacement: {
    title: "Borra una línea del plan",
    what: "",
    affects: [
      "Detalle del plan y su Excel/PDF",
      "Prorrateo mensual y pacing",
      "Estimación de facturación",
      "Análisis por mercado",
    ],
  },
  // plans.ts
  removePublisherFromPlan: {
    title: "Elimina un bloque de publisher del plan y, con él, todas las líneas que colgaban de ese bloque",
    what: "",
    affects: [
      "Detalle del plan y su Excel/PDF",
      "Total de media del plan",
      "Estimación de facturación",
      "Campaign tracker y análisis por publisher",
    ],
  },
  // plan-qa.ts
  reopenPlanQa: {
    title: "Reabre un QA que ya estaba cerrado",
    what: "Borra el cierre y devuelve el plan de «QA realizado» a «aprobado» para volver a revisarlo; las tildas ya hechas no se pierden.",
    affects: [
      "Estado del plan: deja de poder marcarse Live",
      "Tablero de planes (vuelve a contar como Esperando QA)",
      "Ficha del proyecto y detalle del plan",
      "Audit log (queda registrada la reapertura)",
    ],
  },
  // plans.ts
  restorePlan: {
    title: "Saca el plan de la papelera y lo vuelve a poner en circulación con todo su contenido",
    what: "Falla si el nombre ya lo tomó otro plan activo del proyecto.",
    affects: [
      "Papelera de planes",
      "Listado de planes del proyecto",
      "Estimación de facturación y dashboard",
      "Audit log (queda registrado)",
    ],
  },
  // plans.ts
  revertPlanToApprovedSnapshot: {
    title: "Descarta el borrador abierto y devuelve el plan exactamente a como quedó en la última versión aprobada",
    what: "Los fees que ya tienen plata imputada se conservan y se reportan. Es irreversible.",
    affects: [
      "Contenido del plan (publishers, líneas, fees, nombre y notas)",
      "Excel y PDF del plan y portal del cliente",
      "Facturación ya imputada del plan",
      "Audit log (queda registrado)",
    ],
  },
  // creative-billing.ts
  setCreativeBillingPaid: {
    title: "Marca una factura de trabajo creativo como cobrada, o le saca el cobro y la vuelve a dejar como facturada, poniéndole o borrándole la fecha de pago",
    what: "",
    affects: [
      "Pantalla interna de Creative (tabla de facturas, gráfico por mes y totales facturado/cobrado/pendiente)",
      "Tab Creative del portal del cliente: le cambia el cartel de estado de la factura y los tres números de arriba",
      "Plata: mueve el monto de la factura entre 'pendiente de cobro' y 'cobrado'",
      "Audit log: queda registrado quién lo hizo (usuario interno logueado o, si vino del portal, el cliente) con el antes y el después",
    ],
  },
  // plan-billing.ts
  setFeeImputation: {
    title: "Fija a mano cuánto de un fee del plan se imputa a ese mes, sin dejar que la suma de todos los meses supere el fee total pactado",
    what: "Actualiza el total a facturar del mes.",
    affects: [
      "Fees facturados del mes y total a facturar",
      "Reparto del fee entre los meses del plan",
      "Estimación y proyección de facturación del proyecto",
      "Audit log",
    ],
  },
  // campaign-tracker.ts
  setPlacementActual: {
    title: "Carga o pisa el número real acumulado de una métrica de un placement (la plata invertida o una métrica del catálogo del cliente)",
    what: "Guarda un único valor por placement y métrica, así que el dato nuevo reemplaza al anterior y el viejo se pierde.",
    affects: [
      "Pantalla del Campaign Tracker: cambia el consumo real, el porcentaje de avance y el pacing contra lo planeado de ese placement y de todos los totales que lo suman",
      "Dashboard e indicadores generales de consumo, que se recalculan al toque",
      "Métricas derivadas (CPM, CTR y demás), que se calculan al vuelo sobre este valor y quedan distintas",
      "Queda registrado en el audit log con quién lo cambió, el valor anterior y el nuevo",
    ],
  },
  // plan-qa.ts
  setPlanQaCheck: {
    title: "Tilda o destilda una línea del plan como «controlada» en el QA de armado, y deja asentado quién la revisó y cuándo",
    what: "La primera tilda abre el control de esa versión del plan.",
    affects: [
      "Modal de QA del plan (tildas visibles)",
      "Contador de líneas controladas sobre el total",
      "Habilitación del botón para cerrar el QA",
      "Registro de quién controló cada línea",
    ],
  },
  // plan-planning-qa.ts
  setPlanningQaCheck: {
    title: "Tilda o destilda una línea del control de planificación y deja registrado quién la revisó y cuándo",
    what: "Si el QA ya estaba cerrado, destildar lo vuelve a abrir.",
    affects: [
      "Modal de QA de planificación (contador de líneas controladas)",
      "Habilitación del botón Marcar listo para enviar",
      "Registro de quién controló cada línea del plan",
      "Estado de cierre del QA de la versión en curso",
    ],
  },
  // reports.ts
  setProjectStatus: {
    title: "Cambia el estado de un proyecto (planificación, activo, pausado o cerrado) y, cuando lo cierra, le abre sola la ficha del reporte…",
    what: "…final para que entre al calendario. No deja poner 'reportado' a mano ni mover un proyecto que ya se reportó",
    affects: [
      "Grilla de proyectos y ficha del proyecto",
      "Calendario de reportes (al cerrar aparece como pendiente de fecha)",
      "Portal del cliente: el filtro abiertos/cerrados y qué campañas ve",
      "Audit log: queda registrado el estado anterior y el nuevo",
    ],
  },
  // plan-billing.ts
  setPublisherConsumption: {
    title: "Carga cuánto se consumió realmente en un medio durante el mes y si ese consumo se le factura o no al cliente",
    what: "Recalcula solo el management fee del mes y el total a facturar. No deja cargar más de lo que quedaba disponible en el plan.",
    affects: [
      "Facturación real del mes y total a facturar",
      "Management fee prorrateado del mes",
      "Estimación vs. facturado y pacing del proyecto",
      "Audit log",
    ],
  },
  // reports.ts
  setReportDeliveryDate: {
    title: "Asigna o corrige la fecha comprometida de entrega de un reporte (sea de proyecto o ad-hoc) y guarda el momento exacto en que se…",
    what: "…asignó esa fecha. Si el reporte ya se entregó, no permite cambiarla",
    affects: [
      "Calendario de reportes: la fila del Gantt y el compromiso con el cliente",
      "Pendientes del dashboard",
      "Trazabilidad de cuándo se prometió cada entrega (se pisa la marca anterior)",
      "Audit log: queda la fecha vieja y la nueva",
    ],
  },
  // reports.ts
  setReportPptUrl: {
    title: "Guarda o borra el link a la presentación del reporte. Si mandan el mismo link que ya estaba, no cambia nada",
    what: "Si mandan vacío, lo deja sin link.",
    affects: [
      "Calendario de reportes y listado de reportes enviados: el botón para abrir la presentación",
      "Acceso del equipo al documento que se le entregó al cliente",
      "Audit log: registra si se cargó o se borró el link",
    ],
  },
  // app-users.ts
  setUserActive: {
    title: "Activa o desactiva a una persona del equipo",
    what: "Desactivada, deja de tener acceso a la app. Nadie se puede desactivar a sí mismo.",
    affects: [
      "El acceso de esa persona a toda la app",
      "Las tareas que tenía habilitadas, como aprobar planes, dejan de estar disponibles para ella",
      "Pantalla de Configuración → Usuarios y roles",
      "Queda registrado en el audit log como alta o baja",
    ],
  },
  // app-users.ts
  setUserRole: {
    title: "Le cambia el rol a una persona del equipo, es decir qué puede hacer y qué no dentro de la app",
    what: "Si es el último Admin que queda, no la deja bajarlo.",
    affects: [
      "Qué puede aprobar y editar esa persona (por ejemplo, aprobar planes)",
      "Pantallas y secciones que ve al entrar, incluida Configuración",
      "Pantalla de Configuración → Usuarios y roles",
      "Queda registrado en el audit log con el rol anterior y el nuevo",
    ],
  },
  // plan-billing.ts
  transitionBillingStatus: {
    title: "Mueve la facturación del mes de un estado a otro dentro del circuito permitido (borrador, lista, reportada a finanzas, pagada) y…",
    what: "…sella la fecha de reporte o de pago; también permite volver atrás y, al revertir un pago, borra la fecha de pago",
    affects: [
      "Estado del mes en la pantalla de facturación",
      "Portal del cliente (mes marcado como pagado)",
      "Cobranzas y dashboard de facturación",
      "Audit log",
    ],
  },
  // plans.ts
  transitionPlanStatus: {
    title: "Mueve el plan de estado (borrador → listo para enviar → aprobado → QA hecho → live / archivado)",
    what: "Al aprobar congela una versión inmutable del plan; al volver a borrador reabre el QA de planificación.",
    affects: [
      "Estado del plan en todas las vistas",
      "Historial de versiones y su Excel",
      "Estimación, facturación y campaign tracker",
      "Audit log (queda registrado)",
    ],
  },
  // aux-sheets.ts
  updateAuxSheet: {
    title: "Guarda los cambios de una hoja auxiliar",
    what: "Le cambia el nombre al tab, pisa el contenido completo de la grilla (incluidas las fórmulas) y/o actualiza las celdas combinadas.",
    affects: [
      "Detalle del plan: el tab pasa a mostrar el contenido y el nombre nuevos",
      "Excel del plan: la hoja se exporta con los datos nuevos y las fórmulas recalculadas",
      "PDF del plan que firma el cliente: la página de esa hoja sale con los números nuevos",
      "Portal del cliente: el cliente descarga la versión actualizada de los archivos",
      "Audit log: queda el antes y el después de la hoja",
    ],
  },
  // budget-origins.ts
  updateBudgetOrigin: {
    title: "Cambia el nombre y/o el color de un origen de presupuesto ya existente",
    what: "El nombre nuevo pisa al viejo en todos los proyectos que ya lo tenían asignado.",
    affects: [
      "Todos los proyectos y planes que ya usaban ese origen (cambian de nombre en pantalla)",
      "Portal del cliente: etiquetas y filtros por origen de presupuesto",
      "Documentos descargables (Excel de estimación y análisis, reporte histórico, Excel y PDF del plan) que imprimen el nombre del origen",
      "Cortes por origen en Billing, Análisis y Campaign tracker",
      "Audit log (guarda el antes y el después del cambio)",
    ],
  },
  // clients.ts
  updateClient: {
    title: "Edita un cliente ya existente",
    what: "Le cambia el nombre, el prefijo de campañas, el idioma o el estado (activo, pausado o archivado). El slug no se toca.",
    affects: [
      "Idioma de todos los documentos del cliente: PDF del plan y Excels de plan, estimación, pacing y análisis",
      "Acceso al portal del cliente: si se lo archiva, deja de poder entrar y de marcar pagos",
      "Alta de proyectos nuevos y facturación de creativos, que solo toman clientes activos / no archivados",
      "Audit log: queda guardado el antes y el después del cambio",
    ],
  },
  // plans.ts
  updateFee: {
    title: "Cambia el nombre, el monto, el porcentaje o las notas de un fee del plan (si se setea porcentaje de management, el monto pasa a calcularse solo)",
    what: "",
    affects: [
      "Total facturable del plan",
      "Estimación y billing mensual",
      "Excel y PDF del plan",
      "Portal del cliente",
    ],
  },
  // markets.ts
  updateMarket: {
    title: "Renombra un mercado ya existente (y recalcula su identificador interno) o lo prende y apaga del catálogo",
    what: "Si el nombre nuevo choca con otro mercado del mismo cliente, rechaza el cambio en vez de pisarlo.",
    affects: [
      "Nombre del mercado en todas las líneas de planes ya cargadas, incluidas las de planes aprobados",
      "Ubicación de la burbuja en el mapa del tab de Análisis (el identificador se usa para geolocalizar)",
      "Excel del plan y Excel de análisis del portal, que muestran siempre el nombre actual del catálogo",
      "Historial de versiones del plan, donde el cambio de mercado se lee comparando nombres",
      "Disponibilidad del mercado en los desplegables cuando se apaga",
      "Queda registrado en el audit log con el antes y el después",
    ],
  },
  // metrics.ts
  updateMetric: {
    title: "Modifica una métrica existente",
    what: "Le cambia el nombre, la unidad, la fórmula de cálculo o la prende y apaga; apagarla la saca de circulación sin borrarla.",
    affects: [
      "Editor de planes y control de QA del plan: cambia el nombre y el cálculo con el que se validan los números",
      "Campaign tracker: cambia cómo se calculan los reales y el pacing",
      "Portal del cliente y sus descargas de Excel (pacing, reportes históricos, Excel del plan), donde la métrica figura con el nombre y la unidad nuevos",
      "Queda registrada en el audit log con el antes y el después",
    ],
  },
  // plans.ts
  updatePlacement: {
    title: "Edita una línea del plan",
    what: "Nombre, mercado, audiencia, monto, modelo de costo, fechas, métricas o notas.",
    affects: [
      "Prorrateo mensual y pacing",
      "Estimación de facturación",
      "Excel/PDF del plan y portal del cliente",
      "Análisis por publisher y mercado",
    ],
  },
  // plans.ts
  updatePlanMetadata: {
    title: "Cambia el nombre y/o las notas del plan",
    what: "No se puede si el plan está archivado.",
    affects: [
      "Nombre del plan en todas las vistas",
      "Excel y PDF del plan",
      "Portal del cliente",
      "Audit log (queda registrado)",
    ],
  },
  // plans.ts
  updatePlanPublisher: {
    title: "Cambia el presupuesto planificado del bloque de publisher y/o quién paga ese publisher (agencia o cliente)",
    what: "",
    affects: [
      "Total de media del plan",
      "Estimación de facturación y billing mensual",
      "Análisis por publisher",
      "Excel y PDF del plan",
    ],
  },
  // projects.ts
  updateProject: {
    title: "Edita los datos de un proyecto ya existente",
    what: "Nombre, origen de presupuesto, presupuesto bruto total, fecha de inicio, carpeta de Drive y notas.",
    affects: [
      "Detalle del proyecto y su listado",
      "Estimación de facturación y pacing",
      "Portal del cliente",
      "Audit log",
    ],
  },
  // publishers.ts
  updatePublisher: {
    title: "Cambia el nombre de un medio, quién lo paga (agencia o cliente) o lo prende y apaga para que deje de ofrecerse en planes nuevos",
    what: "",
    affects: [
      "Configuración del cliente (lista de publishers)",
      "Nombre del medio en planes, tracker, reportes y exports Excel/PDF ya existentes",
      "Estimación de facturación y fees: tocar 'agencia paga' cambia qué se considera facturable de acá en adelante",
      "Portal del cliente: el nombre y el desglose por medio que ve el cliente",
      "Audit log (guarda el antes y el después del cambio)",
    ],
  },
  // report-comments.ts
  updateReportComment: {
    title: "Reescribe el texto de un comentario ya publicado y le actualiza la fecha de última edición. Pisa la versión anterior",
    what: "En pantalla queda sólo el texto nuevo, el viejo se conserva únicamente en el registro de auditoría. Si el texto es idéntico al que ya estaba, no hace nada.",
    affects: [
      "Modal de comentarios del reporte",
      "Descripción de los reportes manuales, cuando lo editado es el primer comentario",
      "Calendario de reportes y listado de reportes enviados",
      "Audit log: queda el antes y el después del comentario",
    ],
  },
  // simulator.ts
  updateScenario: {
    title: "Pisa el nombre y/o las filas de inversión de un escenario ya guardado",
    what: "Lo anterior se pierde porque no se conserva la versión previa.",
    affects: [
      "Simulador de escenarios",
      "Los números de inversión que después se promueven a un plan real",
      "Comparación del escenario contra planes existentes",
      "Audit log: no deja ningún rastro",
    ],
  },
};
