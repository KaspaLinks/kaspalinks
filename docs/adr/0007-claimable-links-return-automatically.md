# Claimable links return automatically

New single claimable links commit a return address instead of a refund key. The claim branch is
unchanged; after expiry the script lets anyone spend the single funding input, but only into one
output to the committed return address worth at least the input minus the committed fee. Our
worker broadcasts these keyless returns, and any visitor can trigger the same transaction with
"Return now". The server holds no key and cannot redirect funds, so this stays non-custodial, and
because nothing must be backed up, single links can be created without a KaspaLinks account.
