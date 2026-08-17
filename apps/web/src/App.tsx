import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage.js";
import ProjectLayout from "./pages/ProjectLayout.js";
import DashboardPage from "./pages/DashboardPage.js";
import BoardPage from "./pages/BoardPage.js";
import BacklogPage from "./pages/BacklogPage.js";
import ActivityPage from "./pages/ActivityPage.js";
import SettingsPage from "./pages/SettingsPage.js";

export default function App() {
  return (
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
  );
}
