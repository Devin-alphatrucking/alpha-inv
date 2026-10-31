"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toggleAddon } from "./actions";

type Item = { key: string; name: string; description: string; href: string; on: boolean };

export function AddonsPanel({ items }: { items: Item[] }) {
  const [pending, start] = useTransition();

  function flip(item: Item) {
    start(async () => {
      try {
        const r = await toggleAddon(item.key, !item.on);
        if (r.ok) toast.success(item.on ? `${item.name} switched off` : `${item.name} switched on`);
        else toast.error(r.error);
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <Card key={item.key}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{item.name}</CardTitle>
              <Badge variant={item.on ? "default" : "secondary"}>{item.on ? "On" : "Off"}</Badge>
            </div>
            <CardDescription>{item.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button variant={item.on ? "outline" : "default"} disabled={pending} onClick={() => flip(item)}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {item.on ? "Switch off" : "Switch on"}
            </Button>
            {item.on && (
              <Button variant="ghost" nativeButton={false} render={<Link href={item.href} />}>
                Open
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {item.on ? "Switching it off only hides it. Nothing is deleted, and it all comes back if you switch it on again." : "It stays hidden for everyone until you switch it on."}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
