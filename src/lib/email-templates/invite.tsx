import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Click the button below to accept the invitation and create your
          account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept Invitation
        </Button>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this
          email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Geist', Helvetica, Arial, sans-serif" }
const container = {
  padding: '32px 28px',
  maxWidth: '520px',
  border: '1px solid #E4E2DE',
  borderRadius: '2px',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 'normal' as const,
  fontFamily: "'Bricolage Grotesque', Helvetica, Arial, sans-serif",
  color: '#101115',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#6E6E78',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const link = { color: '#e8903a', textDecoration: 'underline' }
const button = {
  backgroundColor: '#e8903a',
  color: '#ffffff',
  fontSize: '13px',
  letterSpacing: '0.04em',
  borderRadius: '2px',
  padding: '12px 22px',
  textDecoration: 'none',
}
const footer = {
  fontSize: '12px',
  color: '#8E8E96',
  margin: '28px 0 0',
  paddingTop: '18px',
  borderTop: '1px solid #E4E2DE',
}
