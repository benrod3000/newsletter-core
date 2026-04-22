"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    SwaggerUIBundle: any;
  }
}

export default function DocsPage() {
  useEffect(() => {
    // Load Swagger UI library from CDN
    const link = document.createElement("link");
    link.href =
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@3/swagger-ui.css";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@3/swagger-ui.bundle.js";
    script.async = true;
    script.onload = () => {
      window.SwaggerUIBundle({
        url: "/api/docs",
        dom_id: "#swagger-ui",
        presets: [
          window.SwaggerUIBundle.presets.apis,
          window.SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: "BaseLayout",
        requestInterceptor: (request: any) => {
          // Auto-inject JWT from localStorage if available
          const auth = localStorage.getItem("auth-storage");
          if (auth) {
            try {
              const authData = JSON.parse(auth);
              if (authData.state?.token) {
                request.headers.Authorization = `Bearer ${authData.state.token}`;
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
          return request;
        },
      });
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div className="bg-white dark:bg-zinc-950 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">
            API Documentation
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Interactive API explorer for Newsletter Elite client endpoints
          </p>
        </div>
        <div id="swagger-ui" className="p-6"></div>
      </div>
    </div>
  );
}
