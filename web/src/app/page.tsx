import { ViewportFit } from "@/components/layout/ViewportFit";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ProtectedApp } from "@/features/auth/ProtectedApp";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export default function Home() {
  return (
    <ThemeProvider>
      <MotionProvider>
        <AuthProvider>
          <ViewportFit />
          <ProtectedApp />
        </AuthProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
