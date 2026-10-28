import { HostNav } from '@/components/host-shell';

export default function HostLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HostNav />
      {children}
    </>
  );
}
