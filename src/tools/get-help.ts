import { type ToolMetadata } from "xmcp";
import { resolveIdentity } from "../lib/identity";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "get-help",
  description:
    "Show the authenticated user what THEY can do with this MCP, based on their role. " +
    "Call it when someone asks 'help', 'que puedo hacer', 'que herramientas tengo' or seems lost. " +
    "Present the capabilities in the user's language, conversationally.",
  annotations: {
    title: "Help / What Can I Do",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

type Capability = {
  what: string;
  example: string;
  roles: string[] | null; // null = any authenticated user; gatekeeper tags otherwise
  needsApprover?: boolean; // T3/T4: gatekeeper also requires the approver flag
};

const CAPABILITIES: Record<string, Capability[]> = {
  "🚗 Inventario": [
    {
      what: "Buscar y filtrar el inventario de vehículos (precio, marca, año, estado, etc.)",
      example: '"mostrame los Porsche 911 debajo de 150 mil"',
      roles: null,
    },
    {
      what: "Agregar o editar notas internas de un vehículo",
      example: '"anotale al stock 480129 que el cliente pidió llamado el lunes"',
      roles: ["team"],
    },
    {
      what: "Cambiar el precio de un vehículo",
      example: '"bajale el precio del VIN ...902 a 145 mil"',
      roles: ["it-manager", "manager", "owner", "admin"],
      needsApprover: true,
    },
    {
      what: "Eliminar un vehículo o sus videos AI (acciones destructivas)",
      example: '"borrá el vehículo stock F012289"',
      roles: ["it-manager", "manager", "owner", "admin"],
      needsApprover: true,
    },
  ],
  "💸 Gastos de autos (programa Argentina)": [
    {
      what: "Cargar un gasto de un auto de cliente — reemplaza el Excel 'Reporte de Autos'",
      example: '"cargale $315 al Mercedes de Maria Fernanda por el lower chrome"',
      roles: ["manager", "owner"],
    },
    {
      what: "Consultar gastos y totales: por cliente, por categoría, por fecha, o buscar facturas",
      example: '"¿cuánto llevamos gastado en el auto de Botti?" / "gastos de junio"',
      roles: ["manager", "owner"],
    },
    {
      what: "Borrar un gasto mal cargado",
      example: '"borrá ese último gasto que lo cargué dos veces"',
      roles: ["manager", "owner"],
      needsApprover: true,
    },
    {
      what: "Auditar los gastos: duplicados, autos sin costo, montos raros",
      example: '"auditá los gastos a ver si está todo bien"',
      roles: ["manager", "owner"],
    },
  ],
  "📊 Analytics y marketing": [
    {
      what: "Reportes de Google: tráfico del sitio (GA4) y búsquedas orgánicas (Search Console)",
      example: '"¿cómo vino el tráfico del sitio este mes vs el anterior?"',
      roles: ["it-manager", "manager", "owner", "admin"],
    },
    {
      what: "Reportes de Meta: campañas, catálogo y redes sociales",
      example: '"¿cómo performaron las campañas de Instagram esta semana?"',
      roles: ["it-manager", "manager", "owner", "admin"],
    },
    {
      what: "Analytics del sitio web (Vercel) y costos de infraestructura IT",
      example: '"¿cuánto gastamos por mes en infraestructura?"',
      roles: ["it-manager", "manager", "owner", "admin"],
    },
  ],
  "📚 Conocimiento del negocio": [
    {
      what: "Consultar la base de conocimiento: políticas, precios, equipo, sistemas",
      example: '"¿cuál es la política de ajuste de precios?"',
      roles: null,
    },
    {
      what: "Ver quién sos para el sistema y qué rol tenés",
      example: '"¿quién soy?"',
      roles: null,
    },
  ],
};

export default async function getHelp() {
  try {
    const identity = await resolveIdentity();
    const tags = identity.profile?.tags ?? [];
    const isApprover = identity.profile?.approver ?? false;

    const canUse = (capability: Capability) =>
      capability.roles === null || capability.roles.some((role) => tags.includes(role));

    const sections: string[] = [];
    let hiddenCount = 0;

    for (const [area, capabilities] of Object.entries(CAPABILITIES)) {
      const available = capabilities.filter(canUse);
      hiddenCount += capabilities.length - available.length;
      if (available.length === 0) continue;
      const lines = available.map((capability) => {
        const approverNote =
          capability.needsApprover && !isApprover
            ? " (necesita aprobación: tu pedido queda registrado como propuesta)"
            : "";
        return `• ${capability.what}${approverNote}\n  Ej: ${capability.example}`;
      });
      sections.push(`${area}\n${lines.join("\n")}`);
    }

    const who = identity.profile
      ? `${identity.profile.title} — ${identity.email}`
      : identity.email ?? "usuario no identificado como parte del equipo";

    return (
      `👋 Ayuda para: ${who}\n\n` +
      `Esto es lo que podés hacer conmigo (habláme normal, yo me encargo de los tools):\n\n` +
      sections.join("\n\n") +
      (hiddenCount > 0
        ? `\n\n🔒 Hay ${hiddenCount} capacidades más restringidas a otros roles.`
        : "") +
      `\n\nTip: no hace falta ningún comando — pedilo con tus palabras y si me falta un dato te lo pregunto.`
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
