"use client";

import { createTheme, MantineProvider } from "@mantine/core";
import type { PropsWithChildren } from "react";

const theme = createTheme({
  defaultRadius: "md",
  fontFamily: "var(--font-sans), Arial, Helvetica, sans-serif",
  headings: {
    fontFamily: "var(--font-sans), Arial, Helvetica, sans-serif",
  },
  primaryColor: "dark",
});

export function MantineAppProvider({ children }: PropsWithChildren) {
  return (
    <MantineProvider defaultColorScheme="auto" theme={theme}>
      {children}
    </MantineProvider>
  );
}
