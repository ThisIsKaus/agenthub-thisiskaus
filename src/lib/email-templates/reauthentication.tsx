import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm reauthentication</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can
          safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
  color: '#6E6E78',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const codeStyle = {
  fontFamily: "'Geist Mono', Courier, monospace",
  fontSize: '24px',
  letterSpacing: '0.16em',
  fontWeight: 'bold' as const,
  color: '#0B0B0D',
  margin: '0 0 30px',
}
const footer = {
  fontSize: '12px',
  color: '#8E8E96',
  margin: '28px 0 0',
  paddingTop: '18px',
  borderTop: '1px solid #E4E2DE',
}
