import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { readPref, writePref } from "./prefs";

export type Theme = "ember" | "paper";

const KEY = "theme";
const DEFAULT: Theme = "ember";

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: DEFAULT,
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function apply(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void readPref<Theme>(KEY).then((stored) => {
      if (cancelled || (stored !== "ember" && stored !== "paper")) return;
      setThemeState(stored);
      apply(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    apply(next);
    void writePref(KEY, next);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
