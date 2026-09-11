use prediction_market_pinocchio::{
    codec::State,
    orders::{ed25519_descriptors, verify_precompile, Order, FILL_LEN},
    state::{quote, OrderState},
};
use solana_address::Address;

fn sample() -> Order {
    Order {
        signer: [1; 32],
        vault: [2; 32],
        market: [3; 32],
        outcome: 1,
        side: 0,
        price: 620_000,
        quantity: 10_000_000,
        nonce: 42,
        expiry: 1_800_000_000,
        epoch: 7,
    }
}
#[test]
fn canonical_order_hash_matches_typescript_golden_vector() {
    let order = sample();
    let hash = order
        .digest(&Address::new_from_array([8; 32]), &[9; 32])
        .unwrap();
    let expected = "c6cbfa550f4da603ef717d89b24745c35f09d18be6be045a1d090a3feebe19dc";
    assert_eq!(
        hash.iter().map(|n| format!("{n:02x}")).collect::<String>(),
        expected
    );
    assert_eq!(Order::decode(&order.encode().unwrap()).unwrap(), order);
}
#[test]
fn malformed_sysvars_and_truncated_order_data_fail_without_panicking() {
    let program = Address::new_from_array([8; 32]);
    let mut fill = vec![0; FILL_LEN];
    fill[0] = 16;
    for length in 0..100 {
        assert!(verify_precompile(&vec![255; length], &program, &fill).is_err());
    }
    for length in 0..138 {
        assert!(Order::decode(&vec![0; length]).is_err());
    }
    assert!(verify_precompile(&[0, 0], &program, &fill).is_err());
    assert_eq!(ed25519_descriptors(5)[4..6], 5_u16.to_le_bytes());
}
#[test]
fn integer_quote_math_never_overflows_intermediate_u64() {
    assert_eq!(quote(u64::MAX, 1_000_000).unwrap(), u64::MAX);
    assert_eq!(quote(1, 1).unwrap(), 1);
    assert_eq!(quote(10, 600_000).unwrap(), 6);
}
#[test]
fn nonce_account_roundtrip_binds_the_full_signed_body() {
    let state = OrderState {
        vault: [2; 32],
        nonce: 42,
        epoch: 7,
        filled: 30,
        cancelled: false,
        bound: true,
        body: sample().encode().unwrap(),
    };
    let mut bytes = vec![0; OrderState::LEN];
    state.encode(&mut bytes).unwrap();
    assert_eq!(OrderState::decode(&bytes).unwrap(), state);
    bytes[0] ^= 1;
    assert!(OrderState::decode(&bytes).is_err());
}
