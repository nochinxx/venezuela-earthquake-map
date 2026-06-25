import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Venezuela Earthquake Map — Daños en tiempo real";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#030712",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          padding: 60,
        }}
      >
        {/* Red seismic wave line */}
        <svg width="600" height="80" viewBox="0 0 600 80" style={{ marginBottom: 32 }}>
          <polyline
            points="0,40 60,40 90,10 120,70 150,20 180,55 230,5 280,75 330,25 370,50 400,40 600,40"
            fill="none"
            stroke="#ef4444"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div style={{ color: "#ef4444", fontSize: 56, fontWeight: 900, letterSpacing: -1, textAlign: "center" }}>
          🇻🇪 Venezuela Earthquake Map
        </div>
        <div style={{ color: "#d1d5db", fontSize: 28, marginTop: 16, textAlign: "center" }}>
          Daños en tiempo real · Terremoto 24 Jun 2026
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 48, marginTop: 40 }}>
          {[
            { label: "YouTube", color: "#fca5a5" },
            { label: "X / Twitter", color: "#93c5fd" },
            { label: "Instagram", color: "#f9a8d4" },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, background: color }} />
              <span style={{ color, fontSize: 20 }}>{label}</span>
            </div>
          ))}
        </div>

        <div style={{ color: "#4b5563", fontSize: 18, marginTop: 32 }}>
          venezuela-earthquake-map.vercel.app
        </div>
      </div>
    ),
    { ...size }
  );
}
