import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="mt-2 text-muted-foreground">Nada publicado neste endereço.</p>
      <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">
        Voltar para o início
      </Link>
    </div>
  );
}
