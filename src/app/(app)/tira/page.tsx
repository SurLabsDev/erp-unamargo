import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";
import { publicImageUrl, storageConfigured } from "@/lib/storage";
import { listStripPhotos } from "./queries";
import { StripManager } from "./strip-manager";

export const metadata: Metadata = { title: "Tira de fotos" };

export default async function StripPage() {
  await requireAdminPage();
  const photos = await listStripPhotos();

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Tira de fotos"
        description="La web las muestra en este orden, corriendo, y cada una con su proporción: las que mejor quedan son las verticales 4:5."
      />
      <StripManager
        photos={photos.map((photo) => ({
          id: photo.id,
          // "" when storage is not configured: the row draws a placeholder.
          url: publicImageUrl(photo.imagePath),
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
        }))}
        storageConfigured={storageConfigured()}
      />
    </div>
  );
}
