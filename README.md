# Cola 3D

Cola de impresiones 3D para amigos y familia: cada uno pega el enlace de la figura (MakerWorld, Bambu Handy, Printables…), elige colores y gramos, y ve lo que cuesta. El dueño la va imprimiendo por orden, cambia estados, lleva el stock de filamento y sabe quién debe qué.

Hecha con React + TypeScript + Vite y animaciones de Framer Motion. Se publica sola en GitHub Pages con cada cambio en `main`.

## Pasar de modo prueba a datos compartidos (Supabase)

Sin Supabase la web funciona en **modo prueba**: cada navegador guarda sus propios pedidos (clave del taller: `1234`).

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En **SQL Editor** pega entero [`supabase/schema.sql`](supabase/schema.sql) y dale a **Run**.
3. En **Project Settings → API** copia la *Project URL* y la clave *anon public*.
4. En GitHub: **Settings → Secrets and variables → Actions → Variables** crea `SUPABASE_URL` y `SUPABASE_ANON_KEY` con esos valores.
5. **Actions → Publicar en GitHub Pages → Run workflow**.
6. Entra en **Taller** con la clave `cambia-esta-clave` y cámbiala.

La clave *anon* es pública a propósito: la base de datos solo deja leer, y todo lo que escribe pasa por funciones que comprueban la clave del taller.

### Opcional: fotos de MakerWorld más fiables

La web saca la foto con microlink.io (gratis, con límite diario). Para no depender de eso:

```
supabase functions deploy preview --no-verify-jwt
```

y crea la variable `PREVIEW_FN` = `1`.

### Opcional: cuentas con correo y contraseña

Crea la variable `CUENTAS` = `1` y vuelve a publicar. Para pedir habrá que entrar con cuenta. Para que tu cuenta sea de administrador, en el SQL Editor:

```sql
insert into public.admins (user_id) select id from auth.users where email = 'tu@correo.com';
```

## Desarrollo

```
pnpm install
pnpm dev
```
