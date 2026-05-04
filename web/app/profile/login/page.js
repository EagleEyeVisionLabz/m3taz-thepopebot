import { auth } from 'thepopebot/auth';
import { ProfileLoginPage } from 'thepopebot/chat';

export default async function Page() {
  const session = await auth();
  return <ProfileLoginPage session={session} />;
}
