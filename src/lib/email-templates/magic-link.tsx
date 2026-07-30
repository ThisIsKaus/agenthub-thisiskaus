import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your login link for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your login link</Heading>
        <Text style={text}>
          Click the button below to log in to {siteName}. This link will expire
          shortly.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Log In
        </Button>
        <Text style={footer}>
          If you didn't request this link, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Helvetica, Arial, sans-serif" }
const container = {
  padding: '32px 28px',
  maxWidth: '520px',
  border: '1px solid #E4E2DE',
  borderRadius: '2px',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 'normal' as const,
  fontFamily: "'Instrument Serif', Georgia, serif",
  color: '#0B0B0D',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#5E5E66',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const button = {
  backgroundColor: '#C8744A',
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
