import type { MetadataRoute } from "next";
import { PRODUCT_NAME } from "@/lib/brand/product";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Browsers fetch the manifest without cookies, so it carries the neutral product
    // name, not a company's. Company names appear everywhere inside the app.
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: "Project-based purchase invoice and payment management.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
