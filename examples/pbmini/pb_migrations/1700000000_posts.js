/// <reference path="../pb_data/types.d.ts" />
// Colección `posts` con reglas: la API pública sólo ve las publicadas.
migrate((app) => {
  const posts = new Collection({
    type: "base", name: "posts",
    listRule: "published = true", viewRule: "published = true", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "title", required: true, max: 200 },
      { type: "text", name: "slug", required: true, max: 100, pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
      { type: "editor", name: "body" },
      { type: "bool", name: "published" },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_posts_slug ON posts (slug)"],
  });
  app.save(posts);
}, (app) => { app.delete(app.findCollectionByNameOrId("posts")); });
