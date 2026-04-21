export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "transparent", margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
