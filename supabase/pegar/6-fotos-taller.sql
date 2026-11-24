-- ---------- fotos: la cuenta del taller puede subirlas y borrarlas ----------
-- La tabla admins no se puede leer desde la web, así que la regla de antes nunca daba permiso.
-- Ahora se comprueba con soy_admin(), que sí puede mirarla.
grant execute on function public.soy_admin() to authenticated;
drop policy if exists "fotos taller sube" on storage.objects;
drop policy if exists "fotos taller borra" on storage.objects;
create policy "fotos taller sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.soy_admin());
create policy "fotos taller borra" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.soy_admin());
