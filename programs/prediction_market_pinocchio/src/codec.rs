use crate::error::{check, Error, Result};

pub struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }
    pub fn bytes<const N: usize>(&mut self) -> Result<[u8; N]> {
        let end = self.offset.checked_add(N).ok_or(Error::InvalidData)?;
        let result = self
            .data
            .get(self.offset..end)
            .ok_or(Error::InvalidData)?
            .try_into()
            .map_err(|_| Error::InvalidData)?;
        self.offset = end;
        Ok(result)
    }
    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes::<1>()?[0])
    }
    pub fn bool(&mut self) -> Result<bool> {
        let value = self.u8()?;
        check(value <= 1, Error::InvalidData)?;
        Ok(value == 1)
    }
    pub fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.bytes()?))
    }
    pub fn u128(&mut self) -> Result<u128> {
        Ok(u128::from_le_bytes(self.bytes()?))
    }
    pub fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_le_bytes(self.bytes()?))
    }
    pub fn done(&self) -> Result<()> {
        check(self.offset == self.data.len(), Error::InvalidData)
    }
}
pub struct Writer<'a> {
    data: &'a mut [u8],
    offset: usize,
}
impl<'a> Writer<'a> {
    pub fn new(data: &'a mut [u8]) -> Self {
        Self { data, offset: 0 }
    }
    pub fn bytes(&mut self, bytes: &[u8]) -> Result<()> {
        let end = self
            .offset
            .checked_add(bytes.len())
            .ok_or(Error::InvalidData)?;
        self.data
            .get_mut(self.offset..end)
            .ok_or(Error::InvalidData)?
            .copy_from_slice(bytes);
        self.offset = end;
        Ok(())
    }
    pub fn u8(&mut self, value: u8) -> Result<()> {
        self.bytes(&[value])
    }
    pub fn bool(&mut self, value: bool) -> Result<()> {
        self.u8(u8::from(value))
    }
    pub fn u64(&mut self, value: u64) -> Result<()> {
        self.bytes(&value.to_le_bytes())
    }
    pub fn u128(&mut self, value: u128) -> Result<()> {
        self.bytes(&value.to_le_bytes())
    }
    pub fn i64(&mut self, value: i64) -> Result<()> {
        self.bytes(&value.to_le_bytes())
    }
}
pub trait State: Sized {
    const TAG: &'static [u8; 8];
    const LEN: usize;
    fn read(r: &mut Reader) -> Result<Self>;
    fn write(&self, w: &mut Writer) -> Result<()>;
    fn decode(data: &[u8]) -> Result<Self> {
        check(data.len() == Self::LEN, Error::InvalidAccount)?;
        let mut r = Reader::new(data);
        check(&r.bytes::<8>()? == Self::TAG, Error::InvalidAccount)?;
        let result = Self::read(&mut r)?;
        r.done()?;
        Ok(result)
    }
    fn encode(&self, data: &mut [u8]) -> Result<()> {
        check(data.len() == Self::LEN, Error::InvalidAccount)?;
        let mut w = Writer::new(data);
        w.bytes(Self::TAG)?;
        self.write(&mut w)
    }
}
