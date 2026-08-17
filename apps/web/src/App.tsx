import { Route, Routes } from "react-router-dom";
import { useLiveSync } from "./lib/liveSync.js";
import HomePage from "./pages/HomePage.js";
import ProjectLayout from "./pages/ProjectLayout.js";
import DashboardPage from "./pages/DashboardPage.js";
import BoardPage from "./pages/BoardPage.js";
import BacklogPage from "./pages/BacklogPage.js";
import ActivityPage from "./pages/ActivityPage.js";
import SettingsPage from "./pages/SettingsPage.js";

export default function App() {
  // One live-sync stream for the whole tab: changes made anywhere (VS Code,
  // another tab, the agent) refresh what's on screen as they happen.
  const liveStatus = useLiveSync();

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects/:id" element={<ProjectLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="board" element={<BoardPage />} />
          <Route path="backlog" element={<BacklogPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>

      {/* Silent while the stream is healthy -- it only speaks up when this
          page can no longer promise it's showing the latest data. */}
      {liveStatus === "offline" && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-xs text-ink-muted shadow-lg">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Live sync offline — reconnecting…
        </div>
      )}
    </>
  );
}
