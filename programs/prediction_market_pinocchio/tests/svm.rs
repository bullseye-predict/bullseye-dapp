#![cfg(feature = "svm-tests")]
//! Runs the compiled SBF artifact in LiteSVM with real SPL-token CPIs and real
//! Ed25519 precompile verification. All keys and tokens are local test fixtures.
use litesvm::{types::TransactionResult, LiteSVM};
use prediction_market_pinocchio::{
    codec::State,
    orders::{self, Order},
    state::{Config, Market, OrderState, Position, Vault, RESOLVED, VOIDED},
};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

fn r(key: Address) -> AccountMeta {
    AccountMeta::new_readonly(key, false)
}
fn w(key: Address) -> AccountMeta {
    AccountMeta::new(key, false)
}
fn s(key: Address) -> AccountMeta {
    AccountMeta::new(key, true)
}
fn bytes(tag: u8, parts: &[&[u8]]) -> Vec<u8> {
    let mut out = vec![tag];
    for p in parts {
        out.extend_from_slice(p);
    }
    out
}
fn derive(program: Address, seeds: &[&[u8]]) -> Address {
    Address::find_program_address(seeds, &program).0
}
fn key(n: u8) -> Keypair {
    Keypair::new_from_array([n; 32])
}
fn addr(n: u8) -> Address {
    key(n).pubkey()
}
struct User {
    owner: Keypair,
    vault: Address,
    escrow: Address,
    token: Address,
    position: Address,
}
struct Fixture {
    svm: LiteSVM,
    program: Keypair,
    admin: Keypair,
    oracle: Keypair,
    mint: Address,
    config: Address,
    market: Address,
    market_escrow: Address,
    domain: [u8; 32],
}
impl Fixture {
    fn new(outcomes: u8) -> Self {
        let mut svm = LiteSVM::new();
        let program = key(1);
        let admin = key(2);
        let oracle = key(3);
        let mint = addr(4);
        let domain = [9; 32];
        let so = std::env::var("SOLZ_SBF_PATH").unwrap_or_else(|_| {
            format!(
                "{}/target/deploy/prediction_market_pinocchio.so",
                env!("CARGO_MANIFEST_DIR")
            )
        });
        svm.add_program_from_file(program.pubkey(), so)
            .expect("run cargo build-sbf before cargo test --features svm-tests");
        for who in [&admin, &oracle] {
            svm.airdrop(&who.pubkey(), 1_000_000_000).unwrap();
        }
        let mut mint_data = vec![0; 82];
        mint_data[44] = 6;
        mint_data[45] = 1;
        svm.set_account(
            mint,
            Account {
                lamports: 10_000_000,
                data: mint_data,
                owner: pinocchio_token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = 1000;
        svm.set_sysvar(&clock);
        let config = derive(program.pubkey(), &[b"prediction_config"]);
        let market = derive(program.pubkey(), &[b"market", &[8; 32]]);
        let market_escrow = derive(program.pubkey(), &[b"market_collateral", market.as_ref()]);
        let init = Instruction {
            program_id: program.pubkey(),
            accounts: vec![
                s(admin.pubkey()),
                w(config),
                r(mint),
                AccountMeta::new_readonly(program.pubkey(), true),
                r(pinocchio_system::ID),
                r(pinocchio_token::ID),
            ],
            data: bytes(0, &[oracle.pubkey().as_ref(), &domain]),
        };
        let tx = Transaction::new(
            &[&admin, &program],
            Message::new(&[init], Some(&admin.pubkey())),
            svm.latest_blockhash(),
        );
        svm.send_transaction(tx).unwrap();
        let mut result = Self {
            svm,
            program,
            admin,
            oracle,
            mint,
            config,
            market,
            market_escrow,
            domain,
        };
        let create = result.ix(
            vec![
                s(result.admin.pubkey()),
                r(config),
                w(market),
                w(market_escrow),
                r(mint),
                r(pinocchio_system::ID),
                r(pinocchio_token::ID),
            ],
            bytes(
                1,
                &[
                    &[8; 32],
                    &[outcomes],
                    &1000_i64.to_le_bytes(),
                    &2000_i64.to_le_bytes(),
                    &3000_i64.to_le_bytes(),
                ],
            ),
        );
        result.send_admin(vec![create]).unwrap();
        result
    }
    fn ix(&self, accounts: Vec<AccountMeta>, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: self.program.pubkey(),
            accounts,
            data,
        }
    }
    fn send_admin(&mut self, ixs: Vec<Instruction>) -> TransactionResult {
        self.svm.expire_blockhash();
        let tx = Transaction::new(
            &[&self.admin],
            Message::new(&ixs, Some(&self.admin.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }
    fn send(&mut self, ixs: Vec<Instruction>, who: &Keypair) -> TransactionResult {
        self.svm.expire_blockhash();
        let tx = Transaction::new(
            &[&self.admin, who],
            Message::new(&ixs, Some(&self.admin.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }
    fn state<T: State>(&self, address: Address) -> T {
        T::decode(&self.svm.get_account(&address).unwrap().data).unwrap()
    }
    fn amount(&self, address: Address) -> u64 {
        let d = self.svm.get_account(&address).unwrap().data;
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    }
    fn user(&mut self, n: u8) -> User {
        let owner = key(n);
        self.svm.airdrop(&owner.pubkey(), 100_000_000).unwrap();
        let vault = derive(
            self.program.pubkey(),
            &[b"agent_vault", owner.pubkey().as_ref()],
        );
        let escrow = derive(
            self.program.pubkey(),
            &[b"vault_collateral", vault.as_ref()],
        );
        let position = derive(
            self.program.pubkey(),
            &[b"position", self.market.as_ref(), vault.as_ref()],
        );
        let token = addr(n + 50);
        let mut data = vec![0; 165];
        data[..32].copy_from_slice(self.mint.as_ref());
        data[32..64].copy_from_slice(owner.pubkey().as_ref());
        data[64..72].copy_from_slice(&1_000_000_u64.to_le_bytes());
        data[108] = 1;
        self.svm
            .set_account(
                token,
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: pinocchio_token::ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        let init = self.ix(
            vec![
                s(owner.pubkey()),
                r(self.config),
                w(vault),
                w(escrow),
                r(self.mint),
                r(pinocchio_system::ID),
                r(pinocchio_token::ID),
            ],
            bytes(2, &[&10_000_000_u64.to_le_bytes()]),
        );
        self.send(vec![init], &owner).unwrap();
        let pos = self.ix(
            vec![
                s(self.admin.pubkey()),
                r(self.market),
                r(vault),
                w(position),
                r(pinocchio_system::ID),
            ],
            vec![3],
        );
        self.send_admin(vec![pos]).unwrap();
        let deposit = self.ix(
            vec![
                s(owner.pubkey()),
                r(self.config),
                w(vault),
                w(token),
                w(escrow),
                r(pinocchio_token::ID),
            ],
            bytes(4, &[&1000_u64.to_le_bytes()]),
        );
        self.send(vec![deposit], &owner).unwrap();
        User {
            owner,
            vault,
            escrow,
            token,
            position,
        }
    }
    fn positions_ix(&self, user: &User, tag: u8, amount: u64) -> Instruction {
        self.ix(
            vec![
                s(user.owner.pubkey()),
                r(self.config),
                w(self.market),
                w(user.vault),
                w(user.position),
                w(user.escrow),
                w(self.market_escrow),
                r(pinocchio_token::ID),
            ],
            if tag == 8 {
                vec![tag]
            } else {
                bytes(tag, &[&amount.to_le_bytes()])
            },
        )
    }
    fn split(&mut self, user: &User, amount: u64) {
        let ix = self.positions_ix(user, 6, amount);
        self.send(vec![ix], &user.owner).unwrap();
    }
    fn nonce(&mut self, user: &User, nonce: u64, cancel: bool) -> Address {
        let order = derive(
            self.program.pubkey(),
            &[b"order", user.vault.as_ref(), &nonce.to_le_bytes()],
        );
        let ix = self.ix(
            vec![
                s(user.owner.pubkey()),
                r(user.vault),
                w(order),
                r(pinocchio_system::ID),
            ],
            bytes(17, &[&nonce.to_le_bytes(), &[u8::from(cancel)]]),
        );
        self.send(vec![ix], &user.owner).unwrap();
        order
    }
    fn order(&self, user: &User, side: u8, nonce: u64, qty: u64, price: u64) -> Order {
        Order {
            signer: user.owner.pubkey().to_bytes(),
            vault: user.vault.to_bytes(),
            market: self.market.to_bytes(),
            outcome: 0,
            side,
            price,
            quantity: qty,
            nonce,
            expiry: 1900,
            epoch: self.state::<Vault>(user.vault).epoch,
        }
    }
    fn fill_ixs(
        &self,
        buyer: &User,
        seller: &User,
        buy: &Order,
        sell: &Order,
        quantity: u64,
        price: u64,
        buy_signer: &Keypair,
        sell_signer: &Keypair,
    ) -> Vec<Instruction> {
        let buy_digest = buy.digest(&self.program.pubkey(), &self.domain).unwrap();
        let sell_digest = sell.digest(&self.program.pubkey(), &self.domain).unwrap();
        let buy_signature = buy_signer.sign_message(&buy_digest);
        let sell_signature = sell_signer.sign_message(&sell_digest);
        let data = bytes(
            16,
            &[
                &buy.encode().unwrap(),
                &sell.encode().unwrap(),
                &quantity.to_le_bytes(),
                &price.to_le_bytes(),
                &buy_digest,
                &sell_digest,
                buy_signature.as_ref(),
                sell_signature.as_ref(),
            ],
        );
        let bn = derive(
            self.program.pubkey(),
            &[b"order", buyer.vault.as_ref(), &buy.nonce.to_le_bytes()],
        );
        let sn = derive(
            self.program.pubkey(),
            &[b"order", seller.vault.as_ref(), &sell.nonce.to_le_bytes()],
        );
        vec![
            Instruction {
                program_id: orders::ED25519_ID,
                accounts: vec![],
                data: orders::ed25519_descriptors(1).to_vec(),
            },
            self.ix(
                vec![
                    r(self.config),
                    w(self.market),
                    w(buyer.vault),
                    w(seller.vault),
                    w(buyer.position),
                    w(seller.position),
                    w(bn),
                    w(sn),
                    w(buyer.escrow),
                    w(seller.escrow),
                    r(pinocchio::sysvars::instructions::INSTRUCTIONS_ID),
                    r(pinocchio_token::ID),
                ],
                data,
            ),
        ]
    }
    fn resolve(&mut self, winner: u8) {
        let lock = self.ix(
            vec![s(self.admin.pubkey()), r(self.config), w(self.market)],
            vec![9],
        );
        self.send_admin(vec![lock]).unwrap();
        let resolve = self.ix(
            vec![s(self.oracle.pubkey()), r(self.config), w(self.market)],
            bytes(10, &[&[winner], &[7; 32], &1000_i64.to_le_bytes()]),
        );
        self.svm.expire_blockhash();
        let tx = Transaction::new(
            &[&self.admin, &self.oracle],
            Message::new(&[resolve], Some(&self.admin.pubkey())),
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).unwrap();
    }
}

#[test]
fn complete_sets_and_resolution_conserve_classic_spl_collateral() {
    let mut f = Fixture::new(3);
    let user = f.user(10);
    f.split(&user, 100);
    assert_eq!(
        f.state::<Position>(user.position).balances[..3],
        [100, 100, 100]
    );
    assert_eq!(
        (f.amount(user.escrow), f.amount(f.market_escrow)),
        (900, 100)
    );
    let merge = f.positions_ix(&user, 7, 40);
    f.send(vec![merge], &user.owner).unwrap();
    f.resolve(2);
    assert_eq!(f.state::<Market>(f.market).status, RESOLVED);
    let redeem = f.positions_ix(&user, 8, 0);
    f.send(vec![redeem], &user.owner).unwrap();
    assert_eq!(
        (f.amount(user.escrow), f.amount(f.market_escrow)),
        (1000, 0)
    );
    assert_eq!(f.state::<Vault>(user.vault).exposure, 0);
    let redeem_again = f.positions_ix(&user, 8, 0);
    assert!(f.send(vec![redeem_again], &user.owner).is_err());
}
#[test]
fn signed_partial_fills_transfer_only_the_agreed_positions_and_quote() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    f.split(&seller, 100);
    let bn = f.nonce(&buyer, 5, false);
    f.nonce(&seller, 6, false);
    let buy = f.order(&buyer, 0, 5, 100, 600_000);
    let sell = f.order(&seller, 1, 6, 100, 500_000);
    let ixs = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        40,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    let tx = Transaction::new(
        &[&f.admin],
        Message::new(&ixs, Some(&f.admin.pubkey())),
        f.svm.latest_blockhash(),
    );
    // A legacy transaction fits without lookup tables or duplicate order payloads.
    assert!(tx.message_data().len() + 65 <= 1232);
    f.send_admin(ixs).unwrap();
    assert_eq!(f.state::<OrderState>(bn).filled, 40);
    assert_eq!(
        (
            f.amount(buyer.escrow),
            f.amount(seller.escrow),
            f.amount(f.market_escrow)
        ),
        (980, 920, 100)
    );
    assert_eq!(f.state::<Position>(buyer.position).balances[0], 40);
    let rest = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        60,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    f.send_admin(rest).unwrap();
    let replay = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        2,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    assert!(f.send_admin(replay).is_err());
    assert_eq!(f.state::<OrderState>(bn).filled, 100);
    f.resolve(0);
    for user in [&buyer, &seller] {
        let ix = f.positions_ix(user, 8, 0);
        f.send(vec![ix], &user.owner).unwrap();
    }
    assert_eq!(
        f.amount(buyer.escrow) + f.amount(seller.escrow) + f.amount(f.market_escrow),
        2000
    );
}
#[test]
fn forged_signature_offsets_fake_sysvar_and_wrong_owners_cannot_move_funds() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    f.split(&seller, 100);
    f.nonce(&buyer, 1, false);
    f.nonce(&seller, 1, false);
    let buy = f.order(&buyer, 0, 1, 100, 600_000);
    let sell = f.order(&seller, 1, 1, 100, 500_000);
    let correct = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    let mut forged = correct.clone();
    forged[1].data[orders::BUY_SIGNATURE_OFFSET] ^= 1;
    assert!(f.send_admin(forged).is_err());
    let mut wrong_offset = correct.clone();
    wrong_offset[0].data[2..4]
        .copy_from_slice(&(orders::SELL_SIGNATURE_OFFSET as u16).to_le_bytes());
    assert!(f.send_admin(wrong_offset).is_err());
    let fake_sysvar = addr(80);
    let real = f
        .svm
        .get_account(&pinocchio::sysvars::instructions::INSTRUCTIONS_ID)
        .unwrap_or(Account {
            lamports: 10_000_000,
            data: vec![0; 4],
            owner: pinocchio_system::ID,
            executable: false,
            rent_epoch: 0,
        });
    f.svm.set_account(fake_sysvar, real).unwrap();
    let mut fake = correct.clone();
    fake[1].accounts[10] = r(fake_sysvar);
    assert!(f.send_admin(fake).is_err());
    let mut missing = correct[1].clone();
    missing.data[293] ^= 1;
    assert!(f.send_admin(vec![missing]).is_err());
    let mut fake_vault = f.svm.get_account(&buyer.vault).unwrap();
    fake_vault.owner = pinocchio_system::ID;
    f.svm.set_account(buyer.vault, fake_vault).unwrap();
    assert!(f.send_admin(correct).is_err());
    assert_eq!(f.amount(buyer.escrow), 1000);
    assert_eq!(f.amount(seller.escrow), 900);
}
#[test]
fn pause_and_cutoff_block_new_risk_but_owner_can_merge_and_withdraw() {
    let mut f = Fixture::new(2);
    let user = f.user(10);
    f.split(&user, 100);
    let pause = f.ix(vec![s(f.admin.pubkey()), w(f.config)], vec![12, 1]);
    f.send_admin(vec![pause]).unwrap();
    assert!(f.state::<Config>(f.config).paused);
    let split = f.positions_ix(&user, 6, 1);
    assert!(f.send(vec![split], &user.owner).is_err());
    let merge = f.positions_ix(&user, 7, 100);
    f.send(vec![merge], &user.owner).unwrap();
    let withdraw = f.ix(
        vec![
            s(user.owner.pubkey()),
            r(f.config),
            w(user.vault),
            w(user.escrow),
            w(user.token),
            r(pinocchio_token::ID),
        ],
        bytes(5, &[&1000_u64.to_le_bytes()]),
    );
    f.send(vec![withdraw], &user.owner).unwrap();
    assert_eq!(f.amount(user.token), 1_000_000);
    let unpause = f.ix(vec![s(f.admin.pubkey()), w(f.config)], vec![12, 0]);
    f.send_admin(vec![unpause]).unwrap();
    let mut clock = f.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 2000;
    f.svm.set_sysvar(&clock);
    let split = f.positions_ix(&user, 6, 1);
    assert!(f.send(vec![split], &user.owner).is_err());
}
#[test]
fn cancelled_nonce_and_epoch_revoke_signed_orders_without_taking_custody() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    f.split(&seller, 100);
    f.nonce(&buyer, 1, true);
    f.nonce(&seller, 1, false);
    let buy = f.order(&buyer, 0, 1, 100, 600_000);
    let sell = f.order(&seller, 1, 1, 100, 500_000);
    let cancelled = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    assert!(f.send_admin(cancelled).is_err());
    f.nonce(&buyer, 2, false);
    let buy = f.order(&buyer, 0, 2, 100, 600_000);
    let revoke = f.ix(vec![s(buyer.owner.pubkey()), w(buyer.vault)], vec![18]);
    f.send(vec![revoke], &buyer.owner).unwrap();
    let stale = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    assert!(f.send_admin(stale).is_err());
    assert_eq!(f.amount(buyer.escrow), 1000);
}
#[test]
fn hermes_can_trade_within_session_limits_but_cannot_withdraw_or_raise_them() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    let agent = key(12);
    f.svm.airdrop(&agent.pubkey(), 100_000_000).unwrap();
    f.split(&seller, 100);
    let policy = bytes(
        14,
        &[
            agent.pubkey().as_ref(),
            &10_000_u64.to_le_bytes(),
            &20_u64.to_le_bytes(),
            &40_u64.to_le_bytes(),
            &1800_i64.to_le_bytes(),
        ],
    );
    let auth = f.ix(
        vec![s(buyer.owner.pubkey()), w(buyer.vault)],
        policy.clone(),
    );
    f.send(vec![auth], &buyer.owner).unwrap();
    f.nonce(&buyer, 1, false);
    f.nonce(&seller, 1, false);
    let mut buy = f.order(&buyer, 0, 1, 20, 600_000);
    buy.signer = agent.pubkey().to_bytes();
    buy.expiry = 1700;
    let sell = f.order(&seller, 1, 1, 100, 500_000);
    let valid = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &agent,
        &seller.owner,
    );
    f.send_admin(valid).unwrap();
    let withdraw = f.ix(
        vec![
            s(agent.pubkey()),
            r(f.config),
            w(buyer.vault),
            w(buyer.escrow),
            w(buyer.token),
            r(pinocchio_token::ID),
        ],
        bytes(5, &[&1_u64.to_le_bytes()]),
    );
    assert!(f.send(vec![withdraw], &agent).is_err());
    let change = f.ix(vec![s(agent.pubkey()), w(buyer.vault)], policy);
    assert!(f.send(vec![change], &agent).is_err());
    f.nonce(&buyer, 2, false);
    let mut excessive = buy.clone();
    excessive.nonce = 2;
    excessive.quantity = 100;
    let ixs = f.fill_ixs(
        &buyer,
        &seller,
        &excessive,
        &sell,
        2,
        500_000,
        &agent,
        &seller.owner,
    );
    assert!(f.send_admin(ixs).is_err());
    f.nonce(&buyer, 3, false);
    let mut old = buy.clone();
    old.nonce = 3;
    let revoke = f.ix(vec![s(buyer.owner.pubkey()), w(buyer.vault)], vec![15]);
    f.send(vec![revoke], &buyer.owner).unwrap();
    let ixs = f.fill_ixs(
        &buyer,
        &seller,
        &old,
        &sell,
        2,
        500_000,
        &agent,
        &seller.owner,
    );
    assert!(f.send_admin(ixs).is_err());
}
#[test]
fn timeout_void_uses_proportional_refunds_and_returns_every_collateral_atom() {
    let mut f = Fixture::new(3);
    let buyer = f.user(10);
    let seller = f.user(11);
    f.split(&seller, 10);
    f.nonce(&buyer, 1, false);
    f.nonce(&seller, 1, false);
    let buy = f.order(&buyer, 0, 1, 2, 500_000);
    let sell = f.order(&seller, 1, 1, 2, 500_000);
    let fill = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        2,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    f.send_admin(fill).unwrap();
    let mut clock = f.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 3000;
    f.svm.set_sysvar(&clock);
    let void = f.ix(
        vec![r(f.admin.pubkey()), r(f.config), w(f.market)],
        bytes(11, &[&[0; 32]]),
    );
    f.send_admin(vec![void]).unwrap();
    assert_eq!(f.state::<Market>(f.market).status, VOIDED);
    for user in [&buyer, &seller] {
        let redeem = f.positions_ix(user, 8, 0);
        f.send(vec![redeem], &user.owner).unwrap();
    }
    assert_eq!(f.amount(f.market_escrow), 0);
    assert_eq!(f.amount(buyer.escrow) + f.amount(seller.escrow), 2000);
}

#[test]
fn oracle_role_is_separate_from_admin_and_result_is_final() {
    let mut f = Fixture::new(2);
    let lock = f.ix(vec![s(f.admin.pubkey()), r(f.config), w(f.market)], vec![9]);
    f.send_admin(vec![lock]).unwrap();
    let forged = f.ix(
        vec![s(f.admin.pubkey()), r(f.config), w(f.market)],
        bytes(10, &[&[0], &[7; 32], &1000_i64.to_le_bytes()]),
    );
    assert!(f.send_admin(vec![forged]).is_err());
    let resolve = f.ix(
        vec![s(f.oracle.pubkey()), r(f.config), w(f.market)],
        bytes(10, &[&[0], &[7; 32], &1000_i64.to_le_bytes()]),
    );
    f.svm.expire_blockhash();
    let tx = Transaction::new(
        &[&f.admin, &f.oracle],
        Message::new(&[resolve], Some(&f.admin.pubkey())),
        f.svm.latest_blockhash(),
    );
    f.svm.send_transaction(tx).unwrap();
    let mut clock = f.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 4000;
    f.svm.set_sysvar(&clock);
    let void = f.ix(
        vec![r(f.admin.pubkey()), r(f.config), w(f.market)],
        bytes(11, &[&[0; 32]]),
    );
    assert!(f.send_admin(vec![void]).is_err());
    assert_eq!(f.state::<Market>(f.market).status, RESOLVED);
}
#[test]
fn market_pause_cutoff_expiry_and_valid_but_reordered_precompile_are_rejected() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    f.split(&seller, 100);
    f.nonce(&buyer, 1, false);
    f.nonce(&seller, 1, false);
    let mut buy = f.order(&buyer, 0, 1, 100, 600_000);
    let mut sell = f.order(&seller, 1, 1, 100, 500_000);
    let valid = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    // Both signatures still verify cryptographically after descriptor reordering;
    // the prediction program rejects the unexpected binding order.
    let mut reordered = valid.clone();
    let first = reordered[0].data[2..16].to_vec();
    let second = reordered[0].data[16..30].to_vec();
    reordered[0].data[2..16].copy_from_slice(&second);
    reordered[0].data[16..30].copy_from_slice(&first);
    assert!(f.send_admin(reordered).is_err());
    let pause = f.ix(
        vec![s(f.admin.pubkey()), r(f.config), w(f.market)],
        vec![13, 1],
    );
    f.send_admin(vec![pause]).unwrap();
    assert!(f.send_admin(valid.clone()).is_err());
    let unpause = f.ix(
        vec![s(f.admin.pubkey()), r(f.config), w(f.market)],
        vec![13, 0],
    );
    f.send_admin(vec![unpause]).unwrap();
    let mut clock = f.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1900;
    f.svm.set_sysvar(&clock);
    assert!(f.send_admin(valid).is_err());
    clock.unix_timestamp = 2000;
    f.svm.set_sysvar(&clock);
    buy.expiry = 2500;
    sell.expiry = 2500;
    let late = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    assert!(f.send_admin(late).is_err());
    assert_eq!(
        (f.amount(buyer.escrow), f.amount(seller.escrow)),
        (1000, 900)
    );
}
#[test]
fn failed_fill_rolls_back_nonces_positions_and_collateral_before_retry() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    f.split(&seller, 100);
    let nonce = f.nonce(&buyer, 1, false);
    f.nonce(&seller, 1, false);
    let withdraw = f.ix(
        vec![
            s(buyer.owner.pubkey()),
            r(f.config),
            w(buyer.vault),
            w(buyer.escrow),
            w(buyer.token),
            r(pinocchio_token::ID),
        ],
        bytes(5, &[&990_u64.to_le_bytes()]),
    );
    f.send(vec![withdraw], &buyer.owner).unwrap();
    let buy = f.order(&buyer, 0, 1, 100, 600_000);
    let sell = f.order(&seller, 1, 1, 100, 500_000);
    let ixs = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        40,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    assert!(f.send_admin(ixs.clone()).is_err());
    assert_eq!(f.state::<OrderState>(nonce).filled, 0);
    assert_eq!(f.state::<Position>(buyer.position).balances[0], 0);
    assert_eq!((f.amount(buyer.escrow), f.amount(seller.escrow)), (10, 900));
    let deposit = f.ix(
        vec![
            s(buyer.owner.pubkey()),
            r(f.config),
            w(buyer.vault),
            w(buyer.token),
            w(buyer.escrow),
            r(pinocchio_token::ID),
        ],
        bytes(4, &[&990_u64.to_le_bytes()]),
    );
    f.send(vec![deposit], &buyer.owner).unwrap();
    f.send_admin(ixs).unwrap();
    assert_eq!(f.state::<OrderState>(nonce).filled, 40);
}

#[test]
fn regression_session_capital_limits_cumulative_spend_on_previously_funded_vault() {
    let mut f = Fixture::new(2);
    let buyer = f.user(10);
    let seller = f.user(11);
    let agent = key(12);
    f.split(&seller, 100);
    let policy = bytes(
        14,
        &[
            agent.pubkey().as_ref(),
            &10_u64.to_le_bytes(),
            &10_u64.to_le_bytes(),
            &1000_u64.to_le_bytes(),
            &1800_i64.to_le_bytes(),
        ],
    );
    let auth = f.ix(vec![s(buyer.owner.pubkey()), w(buyer.vault)], policy);
    f.send(vec![auth], &buyer.owner).unwrap();
    f.nonce(&buyer, 1, false);
    f.nonce(&buyer, 2, false);
    f.nonce(&seller, 1, false);
    let mut buy = f.order(&buyer, 0, 1, 20, 500_000);
    buy.signer = agent.pubkey().to_bytes();
    buy.expiry = 1700;
    let sell = f.order(&seller, 1, 1, 100, 500_000);
    let first = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &agent,
        &seller.owner,
    );
    f.send_admin(first).unwrap();
    buy.nonce = 2;
    let second = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &agent,
        &seller.owner,
    );
    assert!(
        f.send_admin(second).is_err(),
        "a second purchase must not exceed the session's cumulative capital allowance"
    );
    assert_eq!(f.amount(buyer.escrow), 990);
    assert_eq!(f.state::<Vault>(buyer.vault).spent_capital, 10);

    // Selling the position returns cash but does not refill the session budget.
    f.nonce(&buyer, 3, false);
    f.nonce(&seller, 2, false);
    let reverse_buy = f.order(&seller, 0, 2, 20, 500_000);
    let mut reverse_sell = f.order(&buyer, 1, 3, 20, 500_000);
    reverse_sell.signer = agent.pubkey().to_bytes();
    reverse_sell.expiry = 1700;
    let sale = f.fill_ixs(
        &seller,
        &buyer,
        &reverse_buy,
        &reverse_sell,
        20,
        500_000,
        &seller.owner,
        &agent,
    );
    f.send_admin(sale).unwrap();
    assert_eq!(f.amount(buyer.escrow), 1000);
    assert_eq!(f.state::<Vault>(buyer.vault).spent_capital, 10);
    let rebuy = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &agent,
        &seller.owner,
    );
    assert!(f.send_admin(rebuy).is_err());

    // Owner funding and a cancel-all epoch rotation also cannot refill it.
    let deposit = f.ix(
        vec![
            s(buyer.owner.pubkey()),
            r(f.config),
            w(buyer.vault),
            w(buyer.token),
            w(buyer.escrow),
            r(pinocchio_token::ID),
        ],
        bytes(4, &[&100_u64.to_le_bytes()]),
    );
    f.send(vec![deposit], &buyer.owner).unwrap();
    let cancel = f.ix(vec![s(buyer.owner.pubkey()), w(buyer.vault)], vec![18]);
    f.send(vec![cancel], &buyer.owner).unwrap();
    f.nonce(&buyer, 4, false);
    buy.nonce = 4;
    buy.epoch = f.state::<Vault>(buyer.vault).epoch;
    let after_cancel = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &agent,
        &seller.owner,
    );
    assert!(f.send_admin(after_cancel).is_err());
    assert_eq!(f.state::<Vault>(buyer.vault).spent_capital, 10);

    // Only an explicit new owner policy starts a fresh budget and epoch.
    let policy = bytes(
        14,
        &[
            agent.pubkey().as_ref(),
            &10_u64.to_le_bytes(),
            &10_u64.to_le_bytes(),
            &1000_u64.to_le_bytes(),
            &1800_i64.to_le_bytes(),
        ],
    );
    let auth = f.ix(vec![s(buyer.owner.pubkey()), w(buyer.vault)], policy);
    f.send(vec![auth], &buyer.owner).unwrap();
    assert_eq!(f.state::<Vault>(buyer.vault).spent_capital, 0);
    f.nonce(&buyer, 5, false);
    buy.nonce = 5;
    buy.epoch = f.state::<Vault>(buyer.vault).epoch;
    let renewed = f.fill_ixs(
        &buyer,
        &seller,
        &buy,
        &sell,
        20,
        500_000,
        &agent,
        &seller.owner,
    );
    f.send_admin(renewed).unwrap();
    assert_eq!(f.state::<Vault>(buyer.vault).spent_capital, 10);
    f.nonce(&buyer, 6, false);
    let owner_buy = f.order(&buyer, 0, 6, 20, 500_000);
    let manual = f.fill_ixs(
        &buyer,
        &seller,
        &owner_buy,
        &sell,
        20,
        500_000,
        &buyer.owner,
        &seller.owner,
    );
    f.send_admin(manual).unwrap();
    assert_eq!(f.state::<Vault>(buyer.vault).spent_capital, 10);
}
#[test]
fn regression_resolution_deadline_is_exclusive_and_cannot_race_timeout_void() {
    for timestamp in [2999, 3000, 3001] {
        let mut f = Fixture::new(2);
        let lock = f.ix(vec![s(f.admin.pubkey()), r(f.config), w(f.market)], vec![9]);
        f.send_admin(vec![lock]).unwrap();
        let mut clock = f.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = timestamp;
        f.svm.set_sysvar(&clock);
        let resolve = f.ix(
            vec![s(f.oracle.pubkey()), r(f.config), w(f.market)],
            bytes(10, &[&[0], &[7; 32], &1000_i64.to_le_bytes()]),
        );
        f.svm.expire_blockhash();
        let tx = Transaction::new(
            &[&f.admin, &f.oracle],
            Message::new(&[resolve], Some(&f.admin.pubkey())),
            f.svm.latest_blockhash(),
        );
        let result = f.svm.send_transaction(tx);
        if timestamp < 3000 {
            result.unwrap();
        } else {
            assert!(
                result.is_err(),
                "oracle must lose resolution authority exactly at the timeout"
            );
            let void = f.ix(
                vec![r(f.admin.pubkey()), r(f.config), w(f.market)],
                bytes(11, &[&[0; 32]]),
            );
            f.send_admin(vec![void]).unwrap();
            assert_eq!(f.state::<Market>(f.market).status, VOIDED);
        }
    }
}

#[test]
fn policy_cannot_allow_an_order_larger_than_its_capital_budget() {
    let mut f = Fixture::new(2);
    let user = f.user(10);
    let agent = key(12);
    let invalid = bytes(
        14,
        &[
            agent.pubkey().as_ref(),
            &10_u64.to_le_bytes(),
            &20_u64.to_le_bytes(),
            &1000_u64.to_le_bytes(),
            &1800_i64.to_le_bytes(),
        ],
    );
    let auth = f.ix(vec![s(user.owner.pubkey()), w(user.vault)], invalid);
    assert!(f.send(vec![auth], &user.owner).is_err());
    let vault = f.state::<Vault>(user.vault);
    assert!(!vault.enabled);
    assert_eq!(vault.epoch, 0);
    assert_eq!(vault.spent_capital, 0);
}
