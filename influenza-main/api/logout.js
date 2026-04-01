export default function handler(req, res) {
  res.setHeader('Set-Cookie',
    'kreo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
  res.redirect(302, '/login.html');
}
