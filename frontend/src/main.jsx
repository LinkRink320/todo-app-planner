import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import TaskApp from "./pages/App.jsx";
import Login from "./pages/Login.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <Login /> },
  { path: "/login", element: <Login /> },
  { path: "/app", element: <TaskApp /> },
]);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>
);
