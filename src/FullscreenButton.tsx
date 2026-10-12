import { useEffect, useState } from "react";

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

function currentFullscreen() {
  const doc = document as WebkitDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export default function FullscreenButton() {
  const [mobile, setMobile] = useState(false);
  const [active, setActive] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse), (max-width: 900px)");
    const syncMobile = () => setMobile(query.matches);
    const syncActive = () => setActive(Boolean(currentFullscreen()));
    syncMobile();
    syncActive();
    query.addEventListener("change", syncMobile);
    document.addEventListener("fullscreenchange", syncActive);
    document.addEventListener("webkitfullscreenchange", syncActive);
    return () => {
      query.removeEventListener("change", syncMobile);
      document.removeEventListener("fullscreenchange", syncActive);
      document.removeEventListener("webkitfullscreenchange", syncActive);
    };
  }, []);

  if (!mobile) return null;

  async function toggle() {
    setHint("");
    const doc = document as WebkitDocument;
    const root = document.documentElement as WebkitElement;
    try {
      if (currentFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else doc.webkitExitFullscreen?.();
        return;
      }
      if (root.requestFullscreen) await root.requestFullscreen();
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else setHint(homeScreenHint());
    } catch {
      setHint(homeScreenHint());
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        style={{
          position: "fixed",
          top: "max(10px, env(safe-area-inset-top))",
          right: "max(10px, env(safe-area-inset-right))",
          zIndex: 50,
          padding: "10px 14px",
          minHeight: 44,
          fontSize: 15,
          fontWeight: 800,
          border: "1px solid #2a3846",
          borderRadius: 10,
          background: "rgba(24, 34, 43, 0.92)",
          color: "#f8fafc",
          cursor: "pointer",
        }}
      >
        {active ? "Avsluta" : "Helskärm"}
      </button>
      {hint && (
        <div
          style={{
            position: "fixed",
            top: "calc(max(10px, env(safe-area-inset-top)) + 52px)",
            right: "max(10px, env(safe-area-inset-right))",
            zIndex: 50,
            width: "min(280px, calc(100vw - 24px))",
            boxSizing: "border-box",
            padding: "12px 14px",
            borderRadius: 12,
            background: "#18222b",
            border: "1px solid #2a3846",
            color: "#f8fafc",
            fontFamily: "system-ui, sans-serif",
            fontSize: 14,
            lineHeight: 1.4,
          }}
        >
          {hint}
        </div>
      )}
    </>
  );
}

function homeScreenHint() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (ios) {
    return "Tryck på dela-knappen och välj Lägg till på hemskärmen. Öppna sedan Funnel Crash från ikonen, så tar spelet hela skärmen.";
  }
  return "Öppna webbläsarens meny och välj Lägg till på startskärmen. Öppna sedan Funnel Crash från ikonen, så tar spelet hela skärmen.";
}
