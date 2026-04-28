import { auth } from 'thepopebot/auth';
import { ProfileLoginPage } from 'thepopebot/chat';
import { getUserById } from 'thepopebot/db/users';

export default async function Page() {
  const session = await auth();
  const profile = session?.user?.id ? getUserById(session.user.id) : null;
  return <ProfileLoginPage session={session} profile={profile} />;
}
