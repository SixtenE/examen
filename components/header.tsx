"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "./ui/button";

const routes = [
  {
    label: "Upload",
    href: "/",
  },
  {
    label: "Queries",
    href: "/queries",
  },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="bg-background fixed top-0 right-0 left-0 z-50 flex items-center justify-center p-2">
      <nav>
        <ul className="flex">
          {routes.map((route) => (
            <li key={route.href}>
              <Button
                variant={pathname === route.href ? "secondary" : "link"}
                asChild
              >
                <Link href={route.href}>{route.label}</Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
