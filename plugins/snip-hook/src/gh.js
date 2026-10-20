const GH_API_BODY_FLAGS = new Set([
  "-f",
  "--raw-field",
  "-F",
  "--field",
  "--input",
]);
const GH_API_SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * the HTTP method of a `gh api` call that writes, or null for a read or another command. handles
 * BOTH spaced and fused flag forms (gh uses pflag): `-X DELETE` and `-XDELETE`,
 * `--method DELETE`/`--method=DELETE`, `-f k=v`/`-fk=v`, `-F`/`--field`/`--raw-field`/`--input`
 * spaced or `=`-fused; treating a fused form as an opaque `-flag` was the C2/C3 bypass. without a
 * method, any body flag makes it a POST (`gh api --help`: "adding request parameters will
 * automatically switch the request method to POST"). graphql is a read UNLESS the query body
 * contains `mutation`. `rest` is the call without its method flags.
 */
function parseGhApiWrite(tokens) {
  if (tokens[0] !== "gh" || tokens[1] !== "api") {
    return null;
  }
  let method = null;
  let endpoint = null;
  let bodyText = "";
  const rest = [];
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "-X" || token === "--method") {
      method = (tokens[++i] || "").toUpperCase();
      continue;
    }
    const fusedMethod = token.match(/^(?:-X(.+)|--method=(.*))$/);
    if (fusedMethod) {
      method = (fusedMethod[1] ?? fusedMethod[2]).toUpperCase();
      continue;
    }
    rest.push(token);
    if (GH_API_BODY_FLAGS.has(token)) {
      const value = tokens[++i] ?? "";
      bodyText += " " + value;
      rest.push(value);
      continue;
    }
    const fusedBody = token.match(
      /^(?:-[fF](.+)|--(?:field|raw-field|input)=(.*))$/,
    );
    if (fusedBody) {
      bodyText += " " + (fusedBody[1] ?? fusedBody[2]);
      continue;
    }
    if (!token.startsWith("-")) {
      endpoint ??= token;
    }
  }
  let writeMethod = null;
  if (endpoint === "graphql") {
    writeMethod = /\bmutation\b/i.test(bodyText) ? "POST" : null;
  } else if (method) {
    writeMethod = GH_API_SAFE_METHODS.has(method) ? null : method;
  } else if (bodyText !== "") {
    writeMethod = "POST";
  }
  return writeMethod ? { method: writeMethod, rest } : null;
}

/**
 * a `gh api` write spelled with an explicit method, in each form a rule may use, so deny and ask
 * rules like `Bash(gh api -X POST *)` also match the implicit POST `gh api repos/x -f title=bug`
 */
export function ghApiWriteReadings(tokens) {
  const write = parseGhApiWrite(tokens);
  if (!write) {
    return [];
  }
  const { method, rest } = write;
  return [
    ["gh", "api", "-X", method, ...rest],
    ["gh", "api", `-X${method}`, ...rest],
    ["gh", "api", "--method", method, ...rest],
  ];
}
