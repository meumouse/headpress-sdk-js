import type { ContentResult } from "@meumouse.com/headpress";

/** A page, a post or any post type the content module publishes at a storefront path. */
export function ContentTemplate({ content, fallbackTitle }: { content: ContentResult; fallbackTitle?: string }) {
  const post = content.post;
  if (!post) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{fallbackTitle ?? "Conteúdo"}</h1>
        <p className="text-muted-foreground">Nada publicado aqui ainda.</p>
      </div>
    );
  }
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{post.title}</h1>
        {post.type === "post" && post.date && (
          <p className="text-sm text-muted-foreground">
            {new Date(post.date).toLocaleDateString("pt-BR", { dateStyle: "long" })}
            {post.author ? ` · ${post.author.name}` : ""}
          </p>
        )}
      </header>
      {post.featured_image && (
        <img src={post.featured_image.src} alt={post.featured_image.alt} className="w-full rounded-xl object-cover" />
      )}
      {post.protected ? (
        <p className="text-muted-foreground">Este conteúdo é protegido por senha.</p>
      ) : (
        <div className="wp-content" dangerouslySetInnerHTML={{ __html: post.content }} />
      )}
    </article>
  );
}
