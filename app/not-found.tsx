import { Problem } from '@/components/site';

export default function NotFound() {
  return <Problem error={{ status: 404, message: 'The page or home you were looking for has moved, or never existed.' }} />;
}
