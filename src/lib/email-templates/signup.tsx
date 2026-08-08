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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          !
        </Text>
        <Text style={text}>
          Please confirm your email address (
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>
          ) by clicking the button below:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verify Email
        </Button>
        <Text style={footer}>
          If you didn't create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

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
