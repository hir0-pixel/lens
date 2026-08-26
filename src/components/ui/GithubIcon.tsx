import { BrandLogo } from "@/shared/brand/BrandLogo";

interface GithubIconProps {
  className?: string;
}

/** GitHub mark from 21st MCP search_logo → svgl.app */
export default function GithubIcon({ className }: GithubIconProps) {
  return <BrandLogo brand="github" className={className} />;
}
