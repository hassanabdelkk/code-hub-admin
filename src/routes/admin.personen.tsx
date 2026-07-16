import { createFileRoute, Outlet, useLocation, Navigate } from "@tanstack/react-router";

// Parent-Layout für /admin/personen/$id.
// Nur bei exaktem Aufruf von /admin/personen (ohne ID) auf Bewerbungen umleiten.
export const Route = createFileRoute("/admin/personen")({
  component: PersonenLayout,
});

function PersonenLayout() {
  const { pathname } = useLocation();
  if (pathname === "/admin/personen" || pathname === "/admin/personen/") {
    return <Navigate to="/admin/bewerbungen" replace />;
  }
  return <Outlet />;
}
