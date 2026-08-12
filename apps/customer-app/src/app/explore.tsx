import { Redirect } from 'expo-router';

export default function LegacyRoute() { return <Redirect href={"/(tabs)/orders" as never} />; }


