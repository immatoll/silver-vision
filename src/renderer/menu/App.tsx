import React, { useEffect, useRef, useState } from "react";
import type { MenuItem } from "../shared/types";

// -- Helpers ------------------------------------------------------------------

function useFocusGuard() {
  const justFocused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const onFocus = () => {
      justFocused.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        justFocused.current = false;
      }, 500);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (justFocused.current) {
        justFocused.current = false;
        clearTimeout(timer.current);
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, []);
}

function useMouseTracking() {
  useEffect(() => {
    const enter = () => window.electronAPI.mouseenter();
    const leave = () => window.electronAPI.mouseleave();
    document.body.addEventListener("mouseenter", enter);
    document.body.addEventListener("mouseleave", leave);
    return () => {
      document.body.removeEventListener("mouseenter", enter);
      document.body.removeEventListener("mouseleave", leave);
    };
  }, []);
}

// -- AppIcon component ---------------------------------------------------------
// Every icon renders into the same size square with a solid backing (so
// transparent-background source icons don't show the page through them) and
// rounded "app icon" corners that clip whatever's inside — images fill the
// square via object-cover (cropped, not letterboxed) to look uniform next to
// each other regardless of their native aspect ratio.
function AppIcon({
  icon,
  name,
  size = 21,
}: {
  icon?: string;
  name: string;
  size?: number;
}) {
  const iconStr = icon ?? "";
  const radius = Math.round(size * 0.22);

  let inner: React.ReactNode;
  if (iconStr.startsWith("<svg")) {
    inner = (
      <span
        className="flex items-center justify-center w-full h-full [&>svg]:w-full [&>svg]:h-full"
        dangerouslySetInnerHTML={{
          __html: (() => {
            try {
              const parser = new DOMParser();
              const doc = parser.parseFromString(iconStr, "image/svg+xml");
              const svgEl = doc.documentElement;
              svgEl.querySelectorAll("script").forEach((s) => s.remove());
              // Fill the square and crop overflow (like object-cover on <img>) so
              // small/oddly-proportioned source icons still reach full size
              // instead of shrinking to fit and leaving gaps.
              svgEl.setAttribute("width", "100%");
              svgEl.setAttribute("height", "100%");
              svgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
              return svgEl.outerHTML;
            } catch (_) {
              return "";
            }
          })(),
        }}
      />
    );
  } else if (iconStr.match(/^https?:|^data:image\//)) {
    inner = (
      <img
        src={iconStr}
        alt=""
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  } else if (iconStr) {
    inner = (
      <span
        style={{ fontSize: size * 0.62 }}
        className="leading-none flex items-center justify-center w-full h-full"
      >
        {[...iconStr].slice(0, 2).join("")}
      </span>
    );
  } else {
    const words = (name || "?")
      .trim()
      .split(/[\s|_\-\.\/]+/)
      .filter(Boolean);
    const initials =
      words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : (name || "?").slice(0, 2).toUpperCase();
    inner = (
      <span
        className="font-bold text-efc-text-muted"
        style={{ fontSize: size * 0.44 }}
      >
        {initials}
      </span>
    );
  }

  return (
    <span
      className="flex-shrink-0 inline-flex items-center justify-center overflow-hidden bg-efc-surface2 border border-efc-border-subtle"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {inner}
    </span>
  );
}

const itemKey = (item: MenuItem) => item.url || item.name;

// -- Main App ------------------------------------------------------------------
export default function App() {
  useFocusGuard();
  useMouseTracking();

  const api = window.electronAPI;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appStoreOpen, setAppStoreOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    api.menu
      .getCustomItems()
      .then(setMenuItems)
      .catch(() => {});
    api.extension
      .getState()
      .then((s) => setVaultLoaded(s.loaded))
      .catch(() => {});
    api.menu.onItemsChanged(setMenuItems);
    api.menu.onSettingsOpened(() => setSettingsOpen(true));
    api.menu.onSettingsClosed(() => setSettingsOpen(false));
    api.menu.onAppStoreOpened(() => setAppStoreOpen(true));
    api.menu.onAppStoreClosed(() => setAppStoreOpen(false));
    api.menu.onBrowserOpened(() => setBrowserOpen(true));
    api.menu.onBrowserClosed(() => setBrowserOpen(false));
    api.menu.onOverlayOpened((key) =>
      setActiveKeys((prev) => new Set([...prev, key])),
    );
    api.menu.onOverlayClosed((key) =>
      setActiveKeys((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      }),
    );
    api.extension.onStateChanged(setVaultLoaded);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openOverlay(item: MenuItem) {
    const key = itemKey(item);
    if (activeKeys.has(key)) {
      api.menu.closeOverlay(key);
    } else {
      api.menu.openOverlay({
        title: item.name,
        url: item.url,
        width: item.width,
        height: item.height,
      });
    }
  }

  function renderItem(item: MenuItem) {
    const key = itemKey(item);
    const isActive = activeKeys.has(key);
    return (
      <div
        key={key}
        onClick={() => openOverlay(item)}
        className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer border-b border-efc-border-dark transition-colors duration-75 text-[13px] font-bold uppercase tracking-[0.3px]
          ${isActive ? "bg-efc-accent/8 text-efc-accent border-l-2 border-l-efc-accent pl-[10px]" : "text-efc-text hover:bg-[rgba(255,255,255,0.03)]"}`}
      >
        <span className={isActive ? "text-efc-accent" : "text-efc-text-dim"}>
          <AppIcon icon={item.icon} name={item.name} size={21} />
        </span>
        <span className="truncate">{item.name}</span>
      </div>
    );
  }

  // Apps always render sorted by name — no manual ordering/drag-and-drop
  // anymore, so a freshly-added app just slots in alphabetically on its own.
  const visibleItems = menuItems
    .filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sortDir === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name),
    );

  // -- JSX ------------------------------------------------------------------
  return (
    <div className="flex flex-col w-full h-full select-none">
      {/* Titlebar */}
      <div className="h-[38px] flex-shrink-0 flex items-center justify-between px-2 bg-efc-bg border border-efc-border drag">
        <div className="text-[14px] font-bold uppercase text-efc-text tracking-[0.5px]">
          Silver<span className="text-efc-accent">Vision</span>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <svg
            onClick={() => api.menu.openBrowser()}
            className={`w-5 h-5 cursor-pointer transition-opacity duration-100 ${browserOpen ? "opacity-100 text-efc-accent" : "opacity-50 hover:opacity-100"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Browser</title>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
          </svg>
          <svg
            onClick={() => api.menu.openAppStore()}
            className={`w-5 h-5 cursor-pointer transition-opacity duration-100 ${appStoreOpen ? "opacity-100 text-efc-accent" : "opacity-50 hover:opacity-100"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>App Store</title>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <svg
            onClick={() => api.menu.openSettings()}
            className={`w-5 h-5 cursor-pointer transition-opacity duration-100 ${settingsOpen ? "opacity-100 text-efc-accent" : "opacity-50 hover:opacity-100"}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Settings</title>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <svg
            className="w-5 h-5 cursor-pointer opacity-50 hover:opacity-100"
            viewBox="0 0 24 24"
            onClick={() => api.minimize()}
          >
            <rect x="4" y="11" width="16" height="2" fill="var(--color-efc-text)" />
          </svg>
          <svg
            className="w-5 h-5 cursor-pointer opacity-50 hover:opacity-100"
            viewBox="0 0 24 24"
            onClick={() => api.close()}
          >
            <line
              x1="5"
              y1="5"
              x2="19"
              y2="19"
              stroke="var(--color-efc-text)"
              strokeWidth="2"
            />
            <line
              x1="19"
              y1="5"
              x2="5"
              y2="19"
              stroke="var(--color-efc-text)"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0 border-x border-b border-efc-border bg-efc-bg">
        {/* Search + sort bar */}
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-efc-border-dark flex-shrink-0 no-drag">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-efc-text-muted)"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="flex-shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="flex-1 bg-transparent text-[12px] text-efc-text placeholder:text-efc-text-dim outline-none min-w-0"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="flex-shrink-0 text-efc-text-dim hover:text-efc-text transition-colors duration-75"
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Sorted A → Z (click for Z → A)" : "Sorted Z → A (click for A → Z)"}
            className="w-5 h-5 flex items-center justify-center text-efc-text-dim hover:text-efc-text transition-colors duration-75 flex-shrink-0"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h6" />
              <path d="M3 12h4" />
              <path d="M3 18h2" />
              {sortDir === "asc" ? (
                <path d="M17 4v16m0 0-4-4m4 4 4-4" />
              ) : (
                <path d="M17 20V4m0 0-4 4m4-4 4 4" />
              )}
            </svg>
          </button>
        </div>

        {/* App list (scrollable) */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {menuItems.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-efc-text-dim leading-relaxed">
              No apps yet. Open the App Store to browse and add apps.
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-efc-text-dim italic">
              No matches.
            </div>
          ) : (
            visibleItems.map((item) => renderItem(item))
          )}
        </div>

        {/* EVE Vault (bottom, always visible) */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3.5 py-2.5 border-t border-efc-border-dark text-[13px] uppercase tracking-[0.3px]">
          <div
            className={`flex items-center gap-2.5 flex-1 min-w-0 transition-colors duration-75 ${
              vaultLoaded
                ? "text-efc-accent"
                : "text-efc-text hover:text-efc-text"
            }`}
          >
            <span className="flex-1 truncate">EVE VAULT (v0.14)</span>
            {vaultLoaded && (
              <button
                onClick={() => api.extension.openPopup()}
                title="Open EVE Vault wallet UI"
                className="flex-shrink-0 text-[11px] font-bold tracking-[1px] px-1.5 py-0.5 border rounded-sm text-efc-text-muted border-efc-border cursor-pointer"
              >
                Show
              </button>
            )}
            <span
              className={`flex-shrink-0 text-[11px] font-bold tracking-[1px] px-1.5 py-0.5 border rounded-sm cursor-pointer ${
                vaultLoaded
                  ? "text-efc-accent-bright border-efc-accent/40 bg-efc-accent/10"
                  : "text-efc-text-muted border-efc-border"
              }`}
              onClick={() => api.extension.toggle()}
              title="Toggle EVE Vault extension in all overlay windows"
            >
              {vaultLoaded ? "ON" : "OFF"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
