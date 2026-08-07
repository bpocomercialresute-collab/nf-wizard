import { createFileRoute } from "@tanstack/react-router";
import { ComprovantesTab } from "../components/ComprovantesTab";

export const Route = createFileRoute("/comprovantes")({
  head: () => ({
    meta: [
      { title: "Comprovantes Fiscais — NF Wizard" },
      {
        name: "description",
        content:
          "Escaneie e gerencie boletos com OCR em nuvem. Alertas de vencimento, filtros e relatórios.",
      },
    ],
  }),
  component: ComprovantesPage,
});

function ComprovantesPage() {
  return <ComprovantesTab />;
}
