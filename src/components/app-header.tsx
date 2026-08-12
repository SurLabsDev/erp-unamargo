"use client";

import { LogOut, Menu, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; adminOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Panel" },
  { href: "/stock", label: "Stock" },
  { href: "/dinero", label: "Dinero" },
  { href: "/importar", label: "Importar", adminOnly: true },
  { href: "/configuracion", label: "Configuración", adminOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppHeader(props: {
  companyName: string;
  userName: string;
  role: "admin" | "operator";
  onLogout: () => Promise<void>;
}) {
  const { companyName, userName, role, onLogout } = props;
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        {/* Mobile menu */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <SheetHeader>
              <SheetTitle className="text-left text-sm font-semibold uppercase tracking-[0.2em]">
                {companyName}
              </SheetTitle>
            </SheetHeader>
            <nav className="grid gap-1 px-2">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm",
                    isActive(pathname, item.href)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <Link
          href="/"
          className="text-sm font-semibold uppercase tracking-[0.2em]"
        >
          {companyName}
        </Link>

        {/* Desktop nav */}
        <nav className="ml-6 hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                isActive(pathname, item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <UserRound className="size-4" />
                <span className="hidden max-w-32 truncate sm:inline">
                  {userName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-medium">
                  {userName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {role === "admin" ? "Administración" : "Operación"}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void onLogout()}
                className="cursor-pointer"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
