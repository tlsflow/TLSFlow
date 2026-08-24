using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace GCAC.WindowsCompatibilityAgent
{
    /// <summary>
    /// .NET 3.5 没有 Ed25519 实现。Compatibility Agent 只需要验签，因此保留最小的
    /// RFC 8032 验证实现；私钥、签名和签发逻辑绝不进入 Agent。
    /// </summary>
    internal static class Ed25519Verifier
    {
        private static readonly byte[] GroupOrder = new byte[]
        {
            0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10
        };

        private static readonly byte[] EncodedBasePoint = new byte[]
        {
            0x58, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66
        };

        internal static bool Verify(string publicKeyPem, string signature, byte[] message)
        {
            try
            {
                byte[] publicKey = ParseSubjectPublicKeyInfo(publicKeyPem);
                byte[] signatureBytes = DecodeBase64Url(signature);
                if (signatureBytes.Length != 64 || !IsCanonicalScalar(signatureBytes, 32)) return false;

                byte[] encodedR = Slice(signatureBytes, 0, 32);
                byte[] scalarS = Slice(signatureBytes, 32, 32);
                EdPoint publicPoint;
                EdPoint rPoint;
                EdPoint basePoint;
                if (!EdPoint.TryDecode(publicKey, out publicPoint) || !EdPoint.TryDecode(encodedR, out rPoint) || !EdPoint.TryDecode(EncodedBasePoint, out basePoint)) return false;

                byte[] hashInput = new byte[64 + (message == null ? 0 : message.Length)];
                Buffer.BlockCopy(encodedR, 0, hashInput, 0, 32);
                Buffer.BlockCopy(publicKey, 0, hashInput, 32, 32);
                if (message != null) Buffer.BlockCopy(message, 0, hashInput, 64, message.Length);
                byte[] challenge;
                using (SHA512 sha = SHA512.Create()) challenge = Reduce(sha.ComputeHash(hashInput));

                EdPoint left = EdPoint.ScalarMultiply(basePoint, scalarS);
                EdPoint right = EdPoint.Add(rPoint, EdPoint.ScalarMultiply(publicPoint, challenge));
                return SameBytes(left.Encode(), right.Encode());
            }
            catch { return false; }
        }

        private static byte[] ParseSubjectPublicKeyInfo(string pem)
        {
            if (string.IsNullOrEmpty(pem)) throw new InvalidOperationException("Ed25519 公钥 PEM 缺失");
            const string head = "-----BEGIN PUBLIC KEY-----";
            const string tail = "-----END PUBLIC KEY-----";
            int start = pem.IndexOf(head, StringComparison.Ordinal);
            int end = pem.IndexOf(tail, StringComparison.Ordinal);
            if (start < 0 || end <= start) throw new InvalidOperationException("Ed25519 公钥 PEM 格式无效");
            string base64 = pem.Substring(start + head.Length, end - start - head.Length);
            byte[] der = Convert.FromBase64String(Regex.Replace(base64, "\\s", string.Empty));
            int offset = 0;
            RequireTag(der, ref offset, 0x30); int outerLength = ReadLength(der, ref offset); int outerEnd = offset + outerLength;
            RequireTag(der, ref offset, 0x30); int algorithmLength = ReadLength(der, ref offset); int algorithmEnd = offset + algorithmLength;
            RequireTag(der, ref offset, 0x06); int oidLength = ReadLength(der, ref offset);
            if (oidLength != 3 || der[offset] != 0x2b || der[offset + 1] != 0x65 || der[offset + 2] != 0x70) throw new InvalidOperationException("公钥不是 Ed25519");
            offset += oidLength;
            if (offset != algorithmEnd) throw new InvalidOperationException("Ed25519 AlgorithmIdentifier 无效");
            RequireTag(der, ref offset, 0x03); int bitStringLength = ReadLength(der, ref offset);
            if (bitStringLength != 33 || der[offset] != 0x00) throw new InvalidOperationException("Ed25519 公钥长度无效");
            offset++;
            byte[] key = Slice(der, offset, 32); offset += 32;
            if (offset != outerEnd || outerEnd != der.Length) throw new InvalidOperationException("Ed25519 公钥 DER 尾部无效");
            return key;
        }

        private static void RequireTag(byte[] value, ref int offset, byte tag)
        {
            if (offset >= value.Length || value[offset++] != tag) throw new InvalidOperationException("DER 标签无效");
        }

        private static int ReadLength(byte[] value, ref int offset)
        {
            if (offset >= value.Length) throw new InvalidOperationException("DER 长度无效");
            int first = value[offset++];
            if ((first & 0x80) == 0) return first;
            int count = first & 0x7f;
            if (count < 1 || count > 4 || offset + count > value.Length) throw new InvalidOperationException("DER 长度无效");
            int length = 0;
            for (int index = 0; index < count; index++) length = (length << 8) | value[offset++];
            return length;
        }

        private static byte[] DecodeBase64Url(string value)
        {
            if (string.IsNullOrEmpty(value)) throw new InvalidOperationException("签名缺失");
            if (value.Length == 128 && Regex.IsMatch(value, "^[0-9a-f]{128}$")) return DecodeHex(value);
            string base64 = value.Replace('-', '+').Replace('_', '/');
            while ((base64.Length % 4) != 0) base64 += "=";
            return Convert.FromBase64String(base64);
        }

        private static byte[] DecodeHex(string value)
        {
            byte[] result = new byte[64];
            for (int index = 0; index < result.Length; index++)
                result[index] = (byte)((HexValue(value[index * 2]) << 4) | HexValue(value[index * 2 + 1]));
            return result;
        }

        private static int HexValue(char value)
        {
            if (value >= '0' && value <= '9') return value - '0';
            if (value >= 'a' && value <= 'f') return value - 'a' + 10;
            throw new InvalidOperationException("Ed25519 十六进制签名格式无效");
        }

        private static bool IsCanonicalScalar(byte[] signature, int offset)
        {
            byte[] scalar = Slice(signature, offset, 32);
            return CompareLittleEndian(scalar, GroupOrder) < 0;
        }

        private static byte[] Reduce(byte[] value)
        {
            byte[] remainder = new byte[32];
            for (int bit = value.Length * 8 - 1; bit >= 0; bit--)
            {
                int carry = 0;
                for (int index = 0; index < remainder.Length; index++)
                {
                    int next = (remainder[index] & 0x80) == 0 ? 0 : 1;
                    remainder[index] = (byte)((remainder[index] << 1) | carry);
                    carry = next;
                }
                if (((value[bit / 8] >> (bit % 8)) & 1) != 0) remainder[0] |= 1;
                if (CompareLittleEndian(remainder, GroupOrder) >= 0) SubtractLittleEndian(remainder, GroupOrder);
            }
            return remainder;
        }

        private static int CompareLittleEndian(byte[] left, byte[] right)
        {
            for (int index = left.Length - 1; index >= 0; index--)
            {
                if (left[index] < right[index]) return -1;
                if (left[index] > right[index]) return 1;
            }
            return 0;
        }

        private static void SubtractLittleEndian(byte[] value, byte[] subtrahend)
        {
            int borrow = 0;
            for (int index = 0; index < value.Length; index++)
            {
                int current = value[index] - subtrahend[index] - borrow;
                if (current < 0) { current += 256; borrow = 1; }
                else borrow = 0;
                value[index] = (byte)current;
            }
        }

        private static byte[] Slice(byte[] value, int offset, int count)
        {
            byte[] result = new byte[count]; Buffer.BlockCopy(value, offset, result, 0, count); return result;
        }

        private static bool SameBytes(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            int difference = 0;
            for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }

        private sealed class Field
        {
            internal readonly long[] Value;

            internal Field() { Value = new long[10]; }
            internal Field(long[] value) { Value = (long[])value.Clone(); }
            internal static Field Zero() { return new Field(); }
            internal static Field One() { Field result = new Field(); result.Value[0] = 1; return result; }
            internal static Field FromInt(long value) { Field result = new Field(); result.Value[0] = value; return result; }

            internal static Field FromBytes(byte[] value)
            {
                if (value == null || value.Length != 32) throw new InvalidOperationException("Field 字节长度无效");
                Field result = new Field(); int sourceBit = 0;
                for (int limb = 0; limb < 10; limb++)
                {
                    int bits = LimbBits(limb);
                    for (int bit = 0; bit < bits; bit++, sourceBit++)
                        if (sourceBit < 255 && ((value[sourceBit / 8] >> (sourceBit % 8)) & 1) != 0) result.Value[limb] |= 1L << bit;
                }
                return result;
            }

            internal byte[] ToBytes()
            {
                long[] h = (long[])Value.Clone(); Normalize(h);
                long[] modulus = new long[10];
                for (int index = 0; index < modulus.Length; index++) modulus[index] = (1L << LimbBits(index)) - 1;
                modulus[0] -= 18;
                if (CompareLimbs(h, modulus) >= 0)
                {
                    long borrow = 0;
                    for (int index = 0; index < h.Length; index++)
                    {
                        long current = h[index] - modulus[index] - borrow;
                        long baseValue = 1L << LimbBits(index);
                        if (current < 0) { current += baseValue; borrow = 1; } else borrow = 0;
                        h[index] = current;
                    }
                }
                byte[] result = new byte[32]; int targetBit = 0;
                for (int limb = 0; limb < 10; limb++)
                    for (int bit = 0; bit < LimbBits(limb); bit++, targetBit++)
                        if (targetBit < 255 && ((h[limb] >> bit) & 1) != 0) result[targetBit / 8] |= (byte)(1 << (targetBit % 8));
                return result;
            }

            private static void Normalize(long[] value)
            {
                for (int round = 0; round < 8; round++)
                {
                    for (int index = 0; index < 9; index++)
                    {
                        long baseValue = 1L << LimbBits(index);
                        long carry = FloorDivide(value[index], baseValue);
                        value[index] -= carry * baseValue;
                        value[index + 1] += carry;
                    }
                    long lastBase = 1L << LimbBits(9);
                    long lastCarry = FloorDivide(value[9], lastBase);
                    value[9] -= lastCarry * lastBase;
                    value[0] += lastCarry * 19;
                }
            }

            private static long FloorDivide(long value, long divisor)
            {
                long quotient = value / divisor;
                if (value % divisor < 0) quotient--;
                return quotient;
            }

            private static int CompareLimbs(long[] left, long[] right)
            {
                for (int index = left.Length - 1; index >= 0; index--)
                {
                    if (left[index] < right[index]) return -1;
                    if (left[index] > right[index]) return 1;
                }
                return 0;
            }

            internal static Field Add(Field left, Field right) { Field result = new Field(); for (int index = 0; index < 10; index++) result.Value[index] = left.Value[index] + right.Value[index]; return result; }
            internal static Field Subtract(Field left, Field right) { Field result = new Field(); for (int index = 0; index < 10; index++) result.Value[index] = left.Value[index] - right.Value[index]; return result; }
            internal static Field Negate(Field value) { Field result = new Field(); for (int index = 0; index < 10; index++) result.Value[index] = -value.Value[index]; return result; }
            internal static Field Square(Field value) { return Multiply(value, value); }

            internal static Field Multiply(Field left, Field right)
            {
                long[] result = new long[10];
                for (int first = 0; first < 10; first++)
                {
                    for (int second = 0; second < 10; second++)
                    {
                        int target = first + second;
                        long factor = ((first & 1) != 0 && (second & 1) != 0) ? 2 : 1;
                        if (target >= 10) { target -= 10; factor *= 19; }
                        result[target] += factor * left.Value[first] * right.Value[second];
                    }
                }
                Carry(result); Carry(result);
                return new Field(result);
            }

            internal static Field Invert(Field value)
            {
                Field result = One();
                for (int bit = 254; bit >= 0; bit--)
                {
                    result = Square(result);
                    if (bit >= 8 || bit == 7 || bit == 6 || bit == 5 || bit == 3 || bit == 1 || bit == 0) result = Multiply(result, value);
                }
                return result;
            }

            internal static Field PowPMinus5Div8(Field value)
            {
                Field result = One();
                for (int bit = 251; bit >= 0; bit--)
                {
                    result = Square(result);
                    if (bit >= 2 || bit == 0) result = Multiply(result, value);
                }
                return result;
            }

            internal static bool Equals(Field left, Field right) { return SameBytes(left.ToBytes(), right.ToBytes()); }
            internal static bool IsNegative(Field value) { return (value.ToBytes()[0] & 1) != 0; }

            private static int LimbBits(int index) { return (index & 1) == 0 ? 26 : 25; }
            private static void Carry(long[] value)
            {
                for (int round = 0; round < 2; round++)
                {
                    for (int index = 0; index < 10; index++)
                    {
                        int bits = LimbBits(index); long carry = (value[index] + (1L << (bits - 1))) >> bits;
                        if (index == 9) value[0] += carry * 19; else value[index + 1] += carry;
                        value[index] -= carry * (1L << bits);
                    }
                }
            }
        }

        private sealed class EdPoint
        {
            private static readonly Field D = new Field(new long[] { -10913610, 13857413, -15372611, 6949391, 114729, -8787816, -6275908, -3247719, -18696448, -12055116 });
            private static readonly Field SqrtM1 = new Field(new long[] { -32595792, -7943725, 9377950, 3500415, 12389472, -272473, -25146209, -2005654, 326686, 11406482 });
            private readonly Field X;
            private readonly Field Y;
            private readonly Field Z;
            private readonly Field T;

            private EdPoint(Field x, Field y, Field z, Field t) { X = x; Y = y; Z = z; T = t; }

            internal static bool TryDecode(byte[] encoded, out EdPoint point)
            {
                point = null;
                if (encoded == null || encoded.Length != 32) return false;
                byte[] yBytes = (byte[])encoded.Clone(); int sign = (yBytes[31] >> 7) & 1; yBytes[31] &= 0x7f;
                Field y = Field.FromBytes(yBytes);
                byte[] canonicalY = y.ToBytes();
                if (!SameBytes(canonicalY, yBytes)) return false;
                Field y2 = Field.Square(y);
                Field u = Field.Subtract(y2, Field.One());
                Field v = Field.Add(Field.Multiply(D, y2), Field.One());
                Field v2 = Field.Square(v);
                Field v3 = Field.Multiply(v2, v);
                Field v7 = Field.Multiply(Field.Multiply(v3, v2), v2);
                Field x = Field.Multiply(Field.Multiply(u, v3), Field.PowPMinus5Div8(Field.Multiply(u, v7)));
                if (!Field.Equals(Field.Multiply(Field.Square(x), v), u)) x = Field.Multiply(x, SqrtM1);
                if (!Field.Equals(Field.Multiply(Field.Square(x), v), u)) return false;
                if ((Field.IsNegative(x) ? 1 : 0) != sign) x = Field.Negate(x);
                Field left = Field.Subtract(y2, Field.Square(x));
                Field right = Field.Add(Field.One(), Field.Multiply(D, Field.Multiply(Field.Square(x), y2)));
                if (!Field.Equals(left, right)) return false;
                point = new EdPoint(x, y, Field.One(), Field.Multiply(x, y));
                return true;
            }

            internal static EdPoint Add(EdPoint left, EdPoint right)
            {
                Field a = Field.Multiply(Field.Subtract(left.Y, left.X), Field.Subtract(right.Y, right.X));
                Field b = Field.Multiply(Field.Add(left.Y, left.X), Field.Add(right.Y, right.X));
                Field c = Field.Multiply(Field.Multiply(left.T, right.T), Field.Add(D, D));
                Field d = Field.Multiply(Field.Multiply(left.Z, right.Z), Field.FromInt(2));
                Field e = Field.Subtract(b, a); Field f = Field.Subtract(d, c); Field g = Field.Add(d, c); Field h = Field.Add(b, a);
                return new EdPoint(Field.Multiply(e, f), Field.Multiply(g, h), Field.Multiply(f, g), Field.Multiply(e, h));
            }

            internal static EdPoint Double(EdPoint value)
            {
                Field a = Field.Square(value.X); Field b = Field.Square(value.Y); Field c = Field.Multiply(Field.Square(value.Z), Field.FromInt(2));
                Field d = Field.Negate(a); Field e = Field.Subtract(Field.Subtract(Field.Square(Field.Add(value.X, value.Y)), a), b);
                Field g = Field.Add(d, b); Field f = Field.Subtract(g, c); Field h = Field.Subtract(d, b);
                return new EdPoint(Field.Multiply(e, f), Field.Multiply(g, h), Field.Multiply(f, g), Field.Multiply(e, h));
            }

            internal static EdPoint ScalarMultiply(EdPoint point, byte[] scalar)
            {
                EdPoint result = new EdPoint(Field.Zero(), Field.One(), Field.One(), Field.Zero());
                for (int bit = 255; bit >= 0; bit--)
                {
                    result = Double(result);
                    if (((scalar[bit / 8] >> (bit % 8)) & 1) != 0) result = Add(result, point);
                }
                return result;
            }

            internal byte[] Encode()
            {
                Field inverse = Field.Invert(Z); Field x = Field.Multiply(X, inverse); Field y = Field.Multiply(Y, inverse); byte[] encoded = y.ToBytes();
                if (Field.IsNegative(x)) encoded[31] |= 0x80;
                return encoded;
            }
        }
    }
}
