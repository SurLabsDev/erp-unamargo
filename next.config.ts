import type { NextConfig } from "next";

// El host del storage sale de SUPABASE_URL y cambia por instancia, asi que se
// deriva en vez de hardcodearse. Sin esto, <Image> con una foto de Supabase
// tira "hostname is not configured under images".
function supabaseHost(): string | null {
  try {
    return process.env.SUPABASE_URL
      ? new URL(process.env.SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
}

const host = supabaseHost();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: host
      ? [
          {
            protocol: "https",
            hostname: host,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
