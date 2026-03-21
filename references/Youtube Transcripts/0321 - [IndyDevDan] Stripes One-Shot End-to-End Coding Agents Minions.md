[0:00] Are you vibe coding or are you a gentic
[0:02] engineering? The difference is massive.
[0:05] Keep that question in mind as you look
[0:07] at one of the best engineering teams on
[0:09] the planet to determine if they're vibe
[0:12] coding or agentic engineering. Stripe
[0:15] engineers are shipping 1,300 pull
[0:18] requests every single week. Get this.
[0:21] There is zero human written code and
[0:24] they're doing it right. Imagine what
[0:26] will happen to their insane numbers of
[0:28] 1.9 trillion in total volume up 34%
[0:33] which is the equivalent to 1.6 of global
[0:36] GDP. Stripe's doing 1 billion this year
[0:39] and they power all of the best companies
[0:41] that you and I use and you yourself
[0:44] might be running on Stripe as well. What
[0:46] happens when Stripe multiplies all this
[0:49] with agents? And not just agents, what
[0:51] happens when they multiply it with their
[0:52] custom end-to-end solution they're
[0:55] calling minions, fully unattended coding
[0:58] agents that start from a Slack message
[1:00] and end in a production ready PR. This
[1:03] is Stripe's oneshot endto-end coding
[1:06] agent. To me, the minions aren't even
[1:08] the interesting part here. The
[1:10] interesting stat here to me is that
[1:12] their agents operate a code base with
[1:15] millions of lines of code operating a
[1:18] uncommon stack with a number of
[1:20] homegrown libraries that are unique to
[1:23] Stripe and therefore unknown to LLMs. On
[1:27] top of that, the stakes that Stripe
[1:29] operates in are extremely high. The code
[1:32] they write moves over 1 trillion per
[1:35] year of payment volume. They have a
[1:37] number of real world dependencies,
[1:39] regulatory and compliance obligations
[1:41] that their code must honor. Now, here's
[1:43] a simple important question for you. Do
[1:46] you think Stripe can afford to vibe
[1:48] code? I personally have written millions
[1:51] of lines of code with agents and without
[1:54] agents. I've been building with agents
[1:56] since it was first possible way, way
[1:58] back in the day when we were using GPT
[2:00] 3.5 Turbo. Many engineers don't even
[2:03] know that model exists or once existed.
[2:06] So allow me to clarify these terms a
[2:08] little bit. Aentic engineering is
[2:10] knowing what will happen in your system
[2:12] so well you don't need to look. Vibe
[2:16] coding is not knowing and not looking.
[2:18] It's very clear stripe engineers are
[2:21] agentic engineering. And in this video
[2:23] we'll break down stripes aentic layer so
[2:26] you can take the best pieces and add it
[2:29] to your agentic systems. Vibe coding is
[2:32] the lowest hanging fruit. When you
[2:34] agentic engineer systems just like
[2:36] Stripe has, from the prompt to your
[2:38] skills to your custom agents to your
[2:40] agent harness all the way up through
[2:42] your tech stack, you capitalize on the
[2:44] greatest opportunity for engineers to
[2:46] ever exist. Agents,
[2:53] let's look at their agendic system at a
[2:55] high level so that we can analyze the
[2:56] key pieces of their system. If these
[2:59] components interest you, definitely
[3:00] stick around. We're going to be breaking
[3:01] down Stripe's key components. And as we
[3:04] do this, you'll see what you have and
[3:05] what you're missing. All right. So, the
[3:07] first thing is the API layer. They have
[3:09] a way to communicate to their agents. As
[3:11] you'll see, they have many ways to do
[3:13] this. Then they have a warm devbox pool.
[3:16] What is this? This is an agent sandbox,
[3:18] a space to place their agent. Fantastic.
[3:21] They then have the agent harness. Stripe
[3:23] built their agent harness. They forked
[3:24] it from a tool we'll cover in a second
[3:26] here. And then they have this blueprint
[3:28] engine, the marriage of the old world
[3:30] and the new world, code and agents. This
[3:32] is super super important. This single
[3:34] piece has given Stripe a massive edge.
[3:37] You'll see why in a second. All right.
[3:38] Then we have the rules file. How did
[3:40] they manage the context problem? Agents
[3:43] cannot read their 100 million line of
[3:45] code codebase. So how do they solve that
[3:47] problem? We'll then talk about the meta
[3:49] layer of their tool shed. You can
[3:51] imagine they have hundreds of tools and
[3:53] tens of services that they want their
[3:54] agents to operate with. How do they
[3:56] solve that problem? They built a tool
[3:57] shed. All right. Then of course they
[3:59] have a way to validate all their agents
[4:00] work. This is a critical validation
[4:02] layer that they can use to give their
[4:04] agents feedback and to validate that
[4:07] they're not breaking existing working
[4:09] features that's helping them generate
[4:11] and maintain that movement of that $1
[4:13] trillion. All right, so we're talking
[4:15] about real stakes that the Stripe
[4:17] engineers are facing. All right, this is
[4:18] not a green field rapid prototype
[4:20] application. All right, these are
[4:21] serious stakes with real world
[4:23] consequences. And then of course you
[4:24] need a place to review your agents work.
[4:26] They're using GitHub PRs. Everyone's
[4:27] using GitHub PRS. This is the standard.
[4:29] Nothing new here. All right. But these
[4:30] are the critical pieces. We're going to
[4:32] walk through these piece by piece and
[4:34] understand how they put these together
[4:36] to build their Agentic layer. Let's go
[4:37] ahead and start with their minions. So
[4:39] what is Stripe's take on agentic coding?
[4:42] Let's find out. Aentic coding has gone
[4:44] from new and exciting to table stakes.
[4:46] Unattended coding agents have gone from
[4:49] possibility to reality. You know, Stripe
[4:51] engineers know what they're talking
[4:52] about because this is true. If you are
[4:55] not agentic coding, the gap between you
[4:57] and the agent coding team within a week,
[5:00] within a month is going to be
[5:01] astronomical. Okay? It's going to be
[5:03] exponential. This is the last moment to
[5:05] hop on the train. Stripe minions are
[5:07] Stripe's homegrown coding agents.
[5:10] They're fully unattended, built to
[5:11] oneshot tasks. Thousands of pull
[5:14] requests merge each week. So one week
[5:16] goes by, Stripe engineers merge a
[5:18] thousand pull requests. Let's just
[5:21] really understand that scale. All right.
[5:22] And as I mentioned, they contain no
[5:24] human written code. They realize you
[5:26] have to stop coding to get the real
[5:28] scale, to get the real power out of
[5:30] these agents. You work on the agents,
[5:32] not the application. Right? This is a
[5:34] weird mindset shift that you need to
[5:36] make if you're going to be building with
[5:37] agents. Now, interesting to note here,
[5:39] our developers can still plan and
[5:41] collaborate with traditional agent
[5:43] decoding tools, Claude and Cursor. But
[5:46] in a world where one of our most
[5:48] constrained resources is developer
[5:50] attention, the agents allow for
[5:52] parallelization of tasks. This is super
[5:54] super super critical. All right, they
[5:56] realize that the most important resource
[5:58] and really any software company's most
[6:00] important resource is your developers
[6:02] time. It's your developer attention. And
[6:05] when you maximize the leverage your
[6:06] developers get, you can do crazy things
[6:08] like this. They see their engineers
[6:10] spinning up multiple minions in parallel
[6:11] and able to solve multiple problems at
[6:13] the same time in different conditions.
[6:15] All right, so this is fantastic. So the
[6:17] first thing we need to figure out is why
[6:18] they built the minions in the first
[6:20] place. Why did they build it themselves?
[6:22] What's the point of this? Isn't cloud
[6:24] code good enough? Vibe coding a
[6:26] prototype from scratch is fundamentally
[6:28] different from contributing to Stripe's
[6:30] codebase. Okay, interesting. Say more.
[6:31] Stress codebase encompasses hundreds of
[6:33] millions of code across a few large
[6:35] repositories. Okay. Written in Ruby,
[6:38] uncommon stack, homegrown libraries,
[6:40] LLMs don't have it baked in, right? It's
[6:42] not in the models training data. Stakes
[6:45] are high. Stripe moves over 1 trillion
[6:48] per year in payment volume. As
[6:50] mentioned, they have real world
[6:51] dependencies and compliance obligations.
[6:53] LLM agents are really great at building
[6:55] from scratch when there are no
[6:57] constraints on the system. However,
[6:59] iterating on any codebase of scale,
[7:01] complexity, and maturity is inherently
[7:04] much harder. Very, very true. Engineers
[7:06] build sophisticated models to make
[7:09] changes inside their large repo. This is
[7:11] huge. And we talk about this on the
[7:13] channel all the time. Specialization is
[7:15] how you win. When you're building a
[7:17] great product, it is literally a
[7:20] specialized solution to a specialized
[7:22] problem. So, why would you stop at your
[7:25] tooling? Your tooling and your code must
[7:27] also be specialized. So, this is why
[7:30] they built their own custom agent. It's
[7:32] because they're solving specific
[7:34] problems in specific ways better than
[7:36] anyone. And again, this is a theme we
[7:38] talk about on the channel all the time.
[7:40] Specialization is your advantage. And in
[7:43] last week's video, we talked about the
[7:45] PI coding agent because there are many
[7:47] coding agents, but this one is mine. We
[7:50] emphasized this very idea. You can
[7:52] customize your prompt. You can customize
[7:54] your skills. You can customize your
[7:56] custom agents and you can specialize
[7:58] your agent harness. The more you're
[8:00] specializing, the more you're building
[8:02] specific solutions to specific problems,
[8:04] the bigger your edge is. And the more
[8:06] you distance yourself from the out-
[8:08] of-the-box experiences that a lot of
[8:10] agentic coding tools are driving
[8:11] everyone toward, the better off you're
[8:13] going to be. So, Stripe built minions to
[8:16] solve their specific problem and to
[8:18] operate their large code base better
[8:20] than anyone. Makes sense, right? Big
[8:22] shout out to everyone who shared that
[8:23] video. That one went absolutely viral
[8:25] and for a good reason. Engineers are
[8:27] realizing that we don't want to be super
[8:29] locked in to a single tool like cloud
[8:31] code or cursor or codeex or whatever.
[8:33] Every tool is going to have a problem,
[8:34] but the tool that won't have a problem
[8:36] is the one you customize to solve your
[8:38] specific problems better than anyone.
[8:40] There are many coding agents, but this
[8:42] one is mine. I love this slogan. Let's
[8:45] see how Stripe customized their minions.
[8:47] So, what is it like to use a minion?
[8:49] Right away, we jump into another
[8:51] critical idea. There are several entry
[8:53] points for minions. They're designed to
[8:55] integrate as ergonomically as possible
[8:58] where Stripe engineers are. All right,
[9:00] so they use a CLI, a web interface, and
[9:03] they have Slack. Already they have three
[9:05] points of contact for kicking off their
[9:08] API, I assume, right? They they have a
[9:10] separate application which kicks off
[9:12] their agents, right? Their pool of
[9:14] agents, but they have multiple ways to
[9:16] interface with that primary service.
[9:18] Very important. And so we can see here,
[9:19] you know, here's a clear example of an
[9:20] engineer in Stripe using that at symbol
[9:23] at devbox and then they write their
[9:25] prompt to the agent, right? Makes sense.
[9:26] Nothing new there. Okay. And so we can
[9:28] see here they have a custom UI that they
[9:30] built, right? They have an interface to
[9:32] allow them to interface with their
[9:34] custom agent. So you know on the left
[9:36] you can see kind of a typical view. We
[9:38] have that log of tools and the thought
[9:41] process that their agents go through.
[9:42] And then on the right we can see that
[9:43] they have all the modified files. So
[9:45] they can see very very quickly what's
[9:47] going on with that agent. And then of
[9:48] course in the top right here they have
[9:50] their actions. All right, so create pull
[9:51] request. And I'm sure they have some
[9:53] prompt interface here as well. So nice
[9:55] and simple, very concise. You can see
[9:57] that they're just surfacing the most
[9:58] important information. And this hints at
[10:00] another key aspect of your agents and
[10:02] your agentic system. You need to be able
[10:04] to observe what's going on. Once a task
[10:06] has been completed, a minion will create
[10:08] a branch, pushes it to CI, and prepares
[10:10] a pull request following Stripe's PR
[10:13] template. And then they're going to
[10:14] request another review from a Stripe
[10:16] engineer. And they can also iterate. So
[10:18] this is a classic end of process setup.
[10:21] When you're a genta coding, you show up
[10:22] at the beginning and the end during
[10:25] planning and during review and ideally
[10:27] not once in the middle. All right? And
[10:29] that is what creates an outloop agent
[10:32] coding system. You just write the prompt
[10:33] and you just do the review. There's
[10:35] inloop agent coding and then there's
[10:37] outloop agent coding. All right? We'll
[10:38] circle back to that idea in a second. So
[10:40] how do their minions actually work? A
[10:42] minion starts in an isolated developer
[10:45] environment or a dev box. Fascinating.
[10:48] So, this is a concept we've talked about
[10:49] on the channel. They're giving their
[10:50] agents their own environment to operate
[10:52] in, right? Which is the same type of
[10:55] machine that Stripes engineers write on.
[10:57] This is a simple yet powerful idea. If
[10:59] you want your agent to do what you can,
[11:01] you must give it the tools and the
[11:03] environment that you have. So, Stripe
[11:05] realizes this. They reuse their
[11:07] developer setup for their agents. They
[11:09] give them everything that the engineer
[11:11] has. Super super powerful idea here.
[11:13] Dead boxes are pre-warmed, so one can be
[11:15] spun up in 10 seconds. Love that. Uh,
[11:18] not very fast, but for the machine that
[11:20] they're booting up, which I think
[11:21] they'll mention in a moment, that is
[11:22] very fast. They're booting up full-on
[11:24] AWS EC2 instances. All right, with
[11:26] Stripe's code and services preloaded,
[11:29] they're isolated. This is a safe space
[11:31] to place their agent. And they do this
[11:33] so that they can run minions on dev
[11:34] boxes without human permission checks.
[11:37] Of course, this also gives you
[11:38] parallelization without the overhead of
[11:40] something like Git Work trees, which
[11:42] just falls apart at certain scales. All
[11:44] right, after some time, the Git Work
[11:46] trees just fall apart. You're going to
[11:47] need your own dedicated device. I have a
[11:50] Mac Mini here as a local personal kind
[11:52] of private device. But recently, I also
[11:55] just said, "Screw it. I'm going to need
[11:57] more scale." And I started spinning up
[11:58] entire dev boxes for my agents on, you
[12:01] know, use your favorite cloud hosting
[12:03] tool, GCP, AWS, and some of the other
[12:06] ephemeral agent sandbox tools like E2B,
[12:08] modal, so on so forth. But this is a
[12:10] really big idea, right? Um, the more
[12:11] autonomy you give your agents and the
[12:13] more you set up their environment to be
[12:14] yours, the more they can act and perform
[12:17] as you would. The core agent loop runs
[12:19] on a fork of blocks coding agent, goose.
[12:22] One of the first widely used coding
[12:23] agents, which they forked early on. So
[12:26] shout out Goose. They took this and they
[12:28] customized the orchestration flow in an
[12:30] opinionated way to interle agent loops
[12:33] and deterministic code. Huge huge huge
[12:36] idea here and they're going to expand on
[12:38] this even more in a moment here with one
[12:40] of the big ideas they talk about later
[12:42] which is their blueprint engine. Okay,
[12:44] so this is a huge huge huge idea. Let me
[12:47] just emphasize this. You want to be
[12:48] interle agent loop with deterministic
[12:51] code and what type of operations right
[12:52] we're talking get liners and most
[12:54] importantly testing. Okay, this lets
[12:56] your agents, your system operate with
[12:58] feedback. And this gives you the best of
[13:00] both worlds. You get the deterministic
[13:03] world and the non-deterministic
[13:05] reasoning creativity world. And they
[13:06] explicitly say that here they run a mix
[13:08] of creativity of the agent with
[13:10] asurances that they'll always complete
[13:13] stripe specific steps like llinters. So
[13:16] here we have stripe agentic engineering
[13:18] determinism with agents. All right. So a
[13:20] couple additional things to note here.
[13:22] connected to MCP. They use cursor and
[13:24] clawed code and some conditions. They
[13:26] operate agent rule files. We'll talk
[13:28] about that more in a second. This solves
[13:30] the large context problem for Stripe.
[13:32] All agent rules are conditionally
[13:34] applied based on subdirectories. Super
[13:37] important. They have MCP as I mentioned.
[13:39] They have this tool shed idea which is
[13:41] basically a meta tool to help them
[13:43] select one or more of their 400 MCP
[13:46] tools. Okay. A really big piece of why
[13:49] this blog post is so incredible, you
[13:50] know, shout out to the Stripe engineers,
[13:52] shout out to Alistar Gray, is the fact
[13:54] that they're operating at such a massive
[13:56] scale, at such success, and they're
[13:58] still gaining massive value from their
[14:00] agents and from their agentic layer that
[14:02] they're building. All right, managers
[14:03] are built with a goal of oneshotting,
[14:05] but if they don't, the key is to give
[14:06] them feedback. Key key idea. Two more
[14:08] ideas here. We seek to shift feedback
[14:11] left when thinking about developer
[14:12] productivity. The best thing for humans
[14:14] and agents is basically you want the
[14:16] issues to happen earlier rather than
[14:18] later, right? On the engineers's device,
[14:20] on the agents device as early in the
[14:22] process as possible. All right? And then
[14:24] if local testing doesn't catch anything,
[14:26] they have a whole suite of tests over 3
[14:29] million tests that run upon push. Key
[14:31] idea here, they figured out a way to
[14:33] selectively run tests on push. All
[14:35] right? And they're choosing from many of
[14:38] 3 million tests. Okay? And this is going
[14:40] to, as you can imagine, offer feedback
[14:42] to their agentic system. Now, here's
[14:44] something that I would critique Stripe
[14:47] on a little bit here. Due to the cost
[14:48] constraints, they only let their minion
[14:50] run at most two rounds of CI. All right,
[14:53] so you can imagine at this scale that
[14:55] they have to just limit this for it to
[14:56] be costefficient. This is where I would
[14:58] push back a little bit. We'll talk about
[14:59] that later, but this is a interesting
[15:00] thing here, right? So, they basically
[15:02] limited the rounds of feedback for their
[15:04] minion to just two. This is part one of
[15:06] their blog. Let's look at part two and
[15:08] dig into some of the details of some of
[15:10] these key nodes, right? Specifically,
[15:12] their agent sandbox and their powerful
[15:14] blueprint engine because their blueprint
[15:16] engine sits at the center of how they
[15:18] operate their strike minions at scale.
[15:25] So, here's part two, dev boxes hot and
[15:27] ready. So for maximum effectiveness,
[15:30] their minion agents requires a cloud
[15:32] developer environment that's
[15:33] paralyzable, predictable, and isolated.
[15:36] So this is very clearly an agent
[15:38] sandbox. Okay, it gives them a place to
[15:41] operate at scale with full autonomy. And
[15:43] if something goes wrong, if they destroy
[15:45] something, the agent can't cause as much
[15:48] damage as they could if they were
[15:49] operating your device or god forbid a
[15:51] device connected to the production
[15:53] system. And I completely agree.
[15:55] Containerization, get work trees,
[15:56] they're great, but they have hard limits
[15:58] and it's hard to really really scale
[16:00] without giving each agent their own
[16:03] device, right? Again, if you want your
[16:04] agent to perform like you, give them the
[16:06] tools that you have. All right. What
[16:08] else can we learn about Stripes Devbox
[16:10] here? So, very cool. Stripes Devbox is a
[16:14] full-on computer, right? It's an EC2
[16:16] instance and it contains their source
[16:19] code and services under development.
[16:20] Very, very cool. Many engineers use one
[16:22] dev box per tasks and this means that
[16:26] every engineer might have half a dozen
[16:28] running at a time. Check out how awesome
[16:30] this is, right? They're allowing their
[16:31] engineers to scale their impact by
[16:33] allowing parallelization of their agents
[16:36] and every agent has their own sandbox.
[16:38] Okay, so a question I would ask them is,
[16:40] do their minions have access to
[16:42] additional minion sub agents or not even
[16:45] sub agents, other primary agents that
[16:47] are specialized across their code base?
[16:49] Very cool stuff here. This is again part
[16:51] of their agentic system, right? It's
[16:53] giving and servicing scale very very
[16:56] quickly so that engineers can knock out
[16:58] more problems than ever before. All
[17:00] right, we want it to feel effortless to
[17:02] spin up new dev boxes. Right, ready in
[17:04] 10 seconds. Hot and ready. So fantastic.
[17:07] The raw pieces of engineering should
[17:09] feel effortless. You want to be building
[17:10] systems that allow you to move at the
[17:12] agentic speed, the speed of agents.
[17:15] Something kind of funny happened to me
[17:17] the other day while I was reading this
[17:18] blog. Actually, I'll throw the image on
[17:20] the screen. I had to save it. The
[17:21] agentic speed is just insane. Your
[17:23] agents can process information much,
[17:24] much faster than you can. I was reading
[17:27] through this blog, you know, took me
[17:28] maybe, you know, 20 minutes to read
[17:30] through part one and part two, take
[17:32] notes on this. I also spun up a cloud
[17:34] code agent to read the blog alongside
[17:36] me. It read the whole thing, of course,
[17:38] in what was it, 5 seconds. And so I just
[17:41] had like a really funny interaction
[17:43] where uh you know I was shocked and then
[17:46] you know I said something and the agent
[17:48] literally said nothing. It was the first
[17:50] time I've ever had my agent respond with
[17:52] nothing. It was just a really
[17:53] interesting interaction point. And and
[17:55] this is the agentic speed, right? It's
[17:57] this multiplied by every single agent
[17:59] you can spin up. Your agents can read,
[18:01] they can code, they can engineer at
[18:02] agentic speed. So you need to build the
[18:04] system that allows you to tap into that.
[18:06] And you can see here Stripe is doing
[18:08] that with their powerful dev boxes that
[18:10] spin up in just 10 seconds and it
[18:12] somehow sets up their entire gigantic
[18:14] repository. Millions of lines of code,
[18:17] tens and thousands, probably hundreds of
[18:18] thousands of files. All right. And you
[18:20] know, props to Stripe. We built out dev
[18:22] boxes for the needs of human engineers
[18:24] long before LLM coding agents. As it
[18:27] turns out, parallelism, predictability,
[18:29] isolation were very, very good
[18:31] properties for engineers as well as
[18:33] agents. Fantastic. We're almost at the
[18:35] blueprint, which is a really, really big
[18:37] idea. But let's talk about their agent a
[18:39] little bit more, right? So, they built
[18:40] this on their own. They forked Goose.
[18:42] Let me be clear about that. They forked
[18:44] Goose and then they customized it to
[18:46] work within Stripe's LLM infrastructure.
[18:49] Okay? So, you can imagine they have
[18:51] custom prompts, custom skills, custom
[18:53] agents, and then they customize the
[18:55] agent harness. All right? And again,
[18:57] this was the big idea we talked about in
[18:59] last week's video. I'll leave that
[19:00] linked in the description for you if
[19:02] you're interested. Customizing your
[19:04] Aentic harness gives you a massive edge.
[19:06] You can do it your way. You can build it
[19:08] to fit the needs of your specific
[19:10] problem. Okay, once again, I want to
[19:12] beat this idea over the head.
[19:14] Specialization is the advantage of every
[19:17] engineer. Now, you can build specialized
[19:19] solutions, specialized developer tools
[19:21] to help you solve your problems at the
[19:24] agentic speed. Okay, the speed of
[19:26] agents, not the speed of humans. And so
[19:28] they focus their use on the needs of
[19:30] minions rather than human supervised
[19:33] tools. And this is another big idea we
[19:35] need to double click into. That's the
[19:36] use case well filled by third-party
[19:39] tools such as cursor and claw code.
[19:41] Okay, which are made readily available
[19:43] for our engineers. So a couple things
[19:44] here. They're not limiting, they're not
[19:46] forcing their engineers to use any
[19:47] specific tooling. That's a terrible idea
[19:49] in general. But what they are doing is
[19:51] building two types of agent coding
[19:53] tools. Inloop and outloop. I've talked
[19:56] about this on the channel before. This
[19:58] is a critical idea to get right if you
[20:00] want to do more with your agentic
[20:02] engineering. When you are in loop
[20:03] agentic coding, your butts in the seat
[20:05] at your desk and you're prompting back
[20:07] and forth and back and forth and back
[20:09] and forth. This is great for highly
[20:10] specialized work. This is great for when
[20:12] you're building the system that builds
[20:14] the system, but this is bad for
[20:15] everything else. Okay? Uh as a general
[20:18] rule, I recommend to engineers now that
[20:20] you spend more than 50% of your time
[20:22] building the system of agents that build
[20:25] your application for you. That's inloop,
[20:27] right? And that's really the value prop
[20:28] of inloop. You get full control. You can
[20:30] see everything. It's very manual, but it
[20:32] is very slow and expensive. You're using
[20:34] human engineered time. Then there's
[20:36] outloop agent coding. And this is what
[20:38] Stripe's minions offer Stripe. Okay,
[20:40] they are building an Outloop system that
[20:42] operates at scale in parallel in the dev
[20:45] box, right? In dedicated agent
[20:47] sandboxes. This is a big big idea. Why
[20:50] is that? It's because now instead of
[20:52] having one engineer with one terminal or
[20:54] one engineer with three terminals, you
[20:56] can have one engineer with six agent
[20:58] sandboxes operating and solving problems
[21:01] at scale in parallel, right? And six is
[21:03] just the beginning of this. The whole
[21:05] idea here is that you should be handing
[21:06] off more work over time to your Outloop
[21:09] system. If you're building a great
[21:11] agentic layer, if you're building a
[21:12] great system that has agents operating
[21:15] your services for you, you should slowly
[21:17] be handing off more work to them. Okay?
[21:19] And that saves you from the expensive
[21:22] time that you'll spend. And you know,
[21:24] never forget your time is your most
[21:26] important resource. It is constantly
[21:28] running out. Okay? Let me just be super
[21:30] clear about that. But your your agentic
[21:32] systems, you can clone, you can dupe,
[21:34] you can parallelize these as far as your
[21:37] system allows you to. All right? And
[21:39] that's the lever that agentic
[21:41] engineering unlocks. If you build the
[21:43] system that builds the system, you get
[21:45] massive, massive reasoning at scale. you
[21:48] get access to intelligence that
[21:50] engineers your way and at some point
[21:53] better than your way. But uh that's key.
[21:54] So I just wanted to to really dial into
[21:56] that. Minions give Stripe engineers
[21:58] access to outloop agentic coding. Very
[22:01] very powerful. And so they talk about
[22:03] specialization a little bit more. And
[22:05] you know they're really hitting on this
[22:06] this idea I just mentioned there.
[22:08] Offtheshelf local coding agents are
[22:10] usually optimized for workflows where
[22:12] the engineer is sitting looking over his
[22:14] shoulder, right? And I just call this
[22:16] babysitting the agent. Minions are fully
[22:18] unattended and so their agent harness
[22:20] can't use humanfacing features. Okay,
[22:23] they built the minion to be fully
[22:25] autonomous, right? They're built so that
[22:27] humans cannot interject. That's not the
[22:29] point, right? The point is that they
[22:31] operate on their own. Again, inloop
[22:32] agent coding, outloop agentic coding.
[22:35] Cloud code minions. Okay? And just to
[22:37] emphasize it once again, you know, cloud
[22:39] code has the ability cursor has the
[22:40] cursor CLI. And of course, there are
[22:42] great tools we've covered on the channel
[22:44] like pi.dev dev or you can
[22:46] programmatically inject these into your
[22:48] Outloop systems, right? You can deploy
[22:50] an agent outside the loop and have them
[22:52] run on a cron job, have them run via an
[22:54] API request, so on and so forth. All
[22:56] right, that is where all agent engineers
[22:59] must move to get massive leverage. You
[23:01] can see stripes engineers using minions
[23:04] to do just that. All right, so uh they
[23:06] talk about permissions. Uh let's focus
[23:08] on the big idea here right next to dev
[23:10] boxes. The next most important thing
[23:12] here for sure is their blueprint engine.
[23:14] So let's talk about this thing. So what
[23:15] is this? So they talk about workflows
[23:17] versus agents. They talk about loops.
[23:19] They talk about, you know, series of
[23:21] steps, which is like the workflow. This
[23:23] is what a lot of prompts and skills
[23:25] actually are. They're just steps that
[23:27] you want to work through. Sometimes you
[23:28] have an agent that's actually doing some
[23:30] intelligent reasoning, right? Loop with
[23:32] tools. But you can do much better than
[23:34] that. You can push a lot further. And
[23:36] that's exactly what Stripe has done.
[23:37] Minions are orchestrated with a
[23:39] primitive we call blueprints. Blueprints
[23:41] are workflows designed in code that
[23:43] direct a minion run. Okay. And then they
[23:46] go on to say blueprints combine the
[23:48] determinism of workflows with agents
[23:51] flexibility in dealing with the unknown.
[23:54] What is this? Every tactical agent
[23:56] coding member knows this as an ADW, an
[23:59] AI developer workflow. This is the past
[24:01] and the future. This is code plus your
[24:03] agent. Okay, this is the highest
[24:06] leverage point of agent coding is when
[24:08] you put these two together. You have
[24:09] step-by-step workflows that have
[24:11] determinism and non-determinism put
[24:13] together. In essence, a blueprint is
[24:15] like a collection of Asian skills
[24:17] interwoven with deterministic code so
[24:20] that particular subtasks can be handled
[24:22] most appropriately. Okay, there are some
[24:25] things like a llinter for instance or
[24:27] like a git commit or a whole number of
[24:29] things, right? Running tests, creating
[24:31] certain structures, creating certain
[24:32] templates, certain reusable pieces,
[24:35] certain hard deterministic code
[24:37] pathways. There are certain pieces that
[24:39] an agent would perform worse in. Adding
[24:41] an agent to specific steps actually
[24:43] makes the whole system worse, more
[24:45] brittle, and more expensive, frankly.
[24:47] So, for these steps, why would you throw
[24:49] an agent at that problem? Right? The
[24:50] real advantage that Stripe has
[24:52] completely identified here with
[24:53] blueprints is the fact that agents plus
[24:56] code beats agents alone and agents plus
[24:59] code beats code alone. That's the big
[25:01] idea here. So, Alistar goes on to break
[25:03] this concept down here. You have the
[25:05] agent call here implement the task fix
[25:08] the CI failures whatever but you also
[25:10] have the actual nodes run configuration
[25:13] lenders push changes which are fully
[25:15] deterministic okay they don't invoke an
[25:16] LM at all they just run code so imagine
[25:19] you know some toptobottom process where
[25:21] you have agent running and then you have
[25:22] code running and then you have agent
[25:24] running and then you have code running
[25:25] right so on and so forth this is what
[25:27] you want to build right it's this it's
[25:28] the combination of both the agent and
[25:31] your code okay because not everything
[25:33] needs an agent and not Everything needs
[25:35] code. Okay, very very powerful idea
[25:36] here. Another advantage of creating
[25:39] these blueprints of combining code plus
[25:41] agents is that their blueprint machinery
[25:43] makes contact engineering with sub
[25:44] agents easy. Why is that? It's because
[25:46] they're operating at a specific step.
[25:47] And so at that step, you might constrain
[25:49] the tools, you might constrain the
[25:51] system prompt, right? Or you might
[25:52] modify the conversation required by the
[25:55] subtask at hand. Okay? And again, we're
[25:57] hitting on this idea of specialization.
[25:59] There are specific steps in your
[26:01] engineering, in your product, in your
[26:03] tool that you've uniquely implemented.
[26:05] Okay? And so when you can break that
[26:07] down into determinism or in a gentic
[26:10] process step by step, this allows you to
[26:12] specialize, right? And so, you know,
[26:14] once again, what are we doing? We're
[26:16] back at foundational engineering. If
[26:17] you're trying to tackle a big problem,
[26:19] chunk it up into small pieces. every big
[26:21] problem is just a you know a few small
[26:23] problems put together and then chunk
[26:26] those problems into types and then give
[26:28] it to code or give it to agents. Okay,
[26:30] that's what their blueprint system is
[26:31] effectively doing. To me, this is the
[26:33] highest leverage point. This is what
[26:35] makes their agentic layer, their agentic
[26:38] system so powerful. It's the combination
[26:40] of code and agents inside of a
[26:43] repeatable format for success. Okay?
[26:46] Because guess what they can do? They can
[26:47] now deploy meta aentics. they can
[26:49] effectively create an agent that builds
[26:52] their blueprint just in the right way
[26:54] and then they can validate it, right?
[26:56] They I wouldn't be surprised if they had
[26:58] a blueprint for creating blueprints. All
[27:00] right. Anyway, let's move into context.
[27:02] So, they use the rule files setup that
[27:05] you know is much like claude.md or
[27:07] agents.md due to the size of the
[27:10] repository they can't have unconditional
[27:12] job rules. So, they need a specific
[27:13] solution to do this. They're using a
[27:15] standardized rule format much like
[27:17] cursors. All right. So this is a rule
[27:19] format that looks like this. So you have
[27:20] your primary directory whatever tool
[27:22] you're using you know tries to claim
[27:24] that name and then you have / rules and
[27:27] then you have some markdown files right
[27:29] but the interesting part is that you
[27:31] have a markdown file with some front
[27:32] matter. All right, front matter is going
[27:34] to be you know MDC files are like the
[27:36] most popular file format and for good
[27:39] reason right so they have these rules
[27:40] here where you can specify the glob
[27:43] pattern in which to activate this
[27:45] context or you know a specific subset of
[27:47] this context and then they have rule
[27:49] anatomy you can imply intelligently or
[27:51] you can apply only when specific files
[27:54] are being accessed. All right. And so
[27:56] this gives you more control over the
[27:58] context that's loaded as you're
[28:00] accessing different directories
[28:02] throughout your codebase. Okay. And so
[28:04] this is the structure that Stripe
[28:05] Minions use, right? And the big line is
[28:08] right here. We almost exclusively give
[28:10] minions context from files that are
[28:12] scoped to specific subdirectories or
[28:14] patterns automatically attached as the
[28:16] agent traverses the file system. And
[28:19] they're using the, you know, kind of
[28:20] cursor rules to do that. And so they've
[28:22] combined it with a format from cloud
[28:24] code. Once again here you can see that
[28:26] they're building customized agentic
[28:28] solutions that best solves the problems
[28:31] they're facing. Okay and they're
[28:32] combining the best for the industry. I'm
[28:33] not saying that you know cursor agents
[28:35] or claw code agents or how they do
[28:37] things is wrong. That's not the point.
[28:38] There are many ways to do things. The
[28:40] question is what's the best way for you
[28:42] and how do you get the most leverage out
[28:44] of what's available? We can see stripe
[28:45] engineers doing exactly that. Last
[28:47] important idea to mention here is
[28:49] Stripes gathering MCPs. Right. So what
[28:52] are and and how does Stripe put together
[28:55] the tools? So as we all know tools are
[28:57] an essential element of the core for
[29:00] context model prompt tools. Tools is
[29:02] what created agentic coding, right? It's
[29:04] the only reason that any of this is
[29:06] possible because our agents can now use
[29:08] tools to take actions as we can. So how
[29:11] does Stripe handle their 500 MCP tools?
[29:14] Won't this immediately cause a token
[29:16] explosion? Absolutely right. It totally
[29:18] would. What they've done here is they've
[29:20] built a tool shed. They built a
[29:21] centralized internal MCP server called a
[29:24] tool shed which makes it easy for Stripe
[29:26] engineers to make new tools and they're
[29:28] automatically discoverable in their
[29:29] agentic systems. Very very powerful
[29:32] stuff here. Okay. All very agentic
[29:33] systems are able to use the tool shed. I
[29:35] want to be super clear about this. We're
[29:37] talking about meta agentics. This is
[29:39] something that keeps coming up over and
[29:40] over. You build prompts that create
[29:42] prompts. You make agents that build
[29:44] agents. You have skills that build
[29:45] skills. You have tools that allow you to
[29:47] select tools. Okay. The tool shed is a
[29:50] tool that unlocks tools for their
[29:52] agents. Okay, so these are called
[29:55] metaagentics and they're a powerful way
[29:58] to solve the class of problems, right?
[30:00] To to solve repeat problems in the space
[30:03] of agents. And you know, to be clear,
[30:04] this is not new at all, right? OG
[30:06] engineers watching, you've heard of like
[30:08] things like meta programming, right?
[30:10] Passing functions into functions. This
[30:12] is not a new phenomenon, but what is new
[30:14] and what's really important for you and
[30:15] I to focus on when we're building out
[30:17] these powerful agentic layers is to
[30:18] think about when we need to build the
[30:21] thing that builds the thing, right? So,
[30:23] Stripe uses a tool shed to create and
[30:26] connect to over 500 or nearly 500 MCP
[30:30] tools. Okay? Very, very powerful. And
[30:32] you can imagine they have all types of
[30:33] internal and external services that they
[30:35] want to connect to. And the tool shed
[30:37] lets them do that. This was completely
[30:39] net new to me. I had not seen a concept
[30:41] like this before. I think this is really
[30:42] cool. A tool shed centralized location
[30:44] to load specific tools. So, you know,
[30:47] big shout out to the team for uh for
[30:49] building something like this. And then
[30:51] lastly, you know, one of the big ideas
[30:52] they talk about and that's just super
[30:53] critical for engineering. Like this is
[30:55] just great engineering. You just
[30:56] iterate, right? All this stuff is so
[30:58] new. All this stuff is moving so
[30:59] quickly. You and I strip engineers.
[31:01] Doesn't really matter who you are. It's
[31:02] not about what you can do anymore. It's
[31:04] about what you can teach your agents to
[31:06] do for you. Okay? This is a big idea.
[31:08] It's one of the central thesis we talk
[31:10] about in tactical agentic coding in
[31:12] addition to building agentic layers like
[31:15] handing off work and thinking about your
[31:16] agents as tools that you're templating
[31:19] into and templating your engineering
[31:21] into. That's the name of the game,
[31:22] right? Teach your agents how to build
[31:24] like you would so you can scale them to
[31:27] the moon. All right, so what else do we
[31:28] have here? A lot of really great ideas.
[31:30] I'm curious what you think if you've
[31:31] operated in code bases with more than
[31:34] 10,000 files. Comment down below what
[31:36] would you rank Stripe's agentic layer
[31:38] based on everything we've gone through
[31:40] here and you know our highle
[31:41] understanding of their system right they
[31:43] have multiple CI entry points they have
[31:46] EC2 agent sandboxes that mirror
[31:48] developer environments they have their
[31:50] own custom agent harness they have a
[31:52] customizable blueprint engine that lets
[31:54] them combine code and agents together to
[31:56] outperform either they have rules file
[31:59] for context engineering they have tool
[32:01] shed for selecting one of 500 tools or
[32:04] many of 500 tools tools. They of course
[32:06] have CI for self validation and they
[32:08] have GitHub PRs to review the work their
[32:10] agents have done on their dedicated
[32:12] agent sandboxes. All right, so rank
[32:14] this. I'm super curious what you think.
[32:16] Rank Stripes agentic layer out of 10.
[32:19] I'm going to go ahead and give them and
[32:21] and you know again if you've worked on
[32:23] code bases that are larger than 10,000
[32:24] files, no offense, guys, but I don't
[32:26] want to hear a vibe coders opinion on
[32:27] Stripe's endto-end system. But for mid
[32:29] to senior level plus engineers, I'd love
[32:31] to hear what you think. I'm going to
[32:32] give Stripe an eight out of 10. Okay, so
[32:35] very very very powerful agent layer. And
[32:37] let me be super clear here. I have no
[32:38] ego in this. Let me say it this way. I
[32:41] cannot solve Stripe's programmable
[32:43] financial infrastructure problems better
[32:45] than any one of their engineers on their
[32:46] team could. They own that problem in
[32:48] this problem space. So that's not what
[32:49] I'm saying at all. They are the experts
[32:51] there for sure. My expertise is in
[32:53] agentic engineering. It's in building
[32:54] agentic layers. And so I only have two
[32:57] notes of of feedback for them here that
[32:59] I would pitch to them as potential
[33:01] improvements. The first thing is this.
[33:02] you know, they they identify this right
[33:04] away. Why only two rounds of feedback in
[33:06] their CI for their agents? Okay. And so
[33:08] they say, you know, speed, completeness,
[33:10] cost, time, compute, blah blah blah.
[33:11] These are fair constraints and reasons
[33:14] to only run two rounds. But I think this
[33:16] is a mistake, frankly. Think about
[33:17] yourself as an engineer. Has anyone ever
[33:19] said to you, "Solve this problem. You
[33:20] have two attempts."
[33:22] All right? You just have two shots at
[33:24] this. Uh, no. No one said that. Right?
[33:26] It often takes us tens and hundreds of
[33:28] times to get something right. So, I
[33:29] think limiting their minions to just two
[33:32] shots is potentially going to cost them
[33:35] more developer time and also increase
[33:38] the gap between the next learning of how
[33:41] to improve their agentic system by
[33:42] letting their agents run more, right?
[33:44] Like, I think the learnings you get from
[33:46] running five rounds of your agent is
[33:48] going to be a lot more informative than
[33:49] running just two. All right, but I could
[33:50] be totally wrong. Again, they know their
[33:52] system better than we do. All right, but
[33:53] that's my first note. And my last note
[33:55] here is in the language of their
[33:59] minions. So, you know, they call these
[34:02] end to-end agents, but you might have
[34:04] noticed they have a prompt step and they
[34:07] have a review step. Okay, that's two
[34:10] steps. End to end is this, right? And
[34:13] you take out the review, right? It's
[34:15] prompt to production, P2P. Okay? And
[34:18] this is something we've talked about
[34:19] inside of Tactical Agentic Coding. This
[34:21] is the northstar for all agentic
[34:23] engineers. This is an idea, a concept
[34:26] called ZTE, zero touch engineering,
[34:29] prompt to production. No review, no
[34:31] human in the loop. I want to be a little
[34:33] critical about their language here. I
[34:35] know that this is industry standard and
[34:36] of course, again, of course, they're
[34:38] operating on a scale most of us
[34:40] engineers will never get to, but that's
[34:43] what I would push Stripe to think about
[34:44] next. What are the lowlevel simple
[34:47] tasks? maybe some lower risk tasks,
[34:49] developer tools stuff, you know, some
[34:51] non-userfacing stuff and even some
[34:53] userfacing stuff that they could ship
[34:54] actually end to end. And the value isn't
[34:57] in doing it. It's in answering the
[34:58] question, what would it take for you to
[35:01] run a prompt and trust that your agentic
[35:03] system can deliver this to production
[35:06] without human oversight, right? The
[35:08] value is in the journey of the question.
[35:10] So, that's that's another area where I
[35:12] would just like really try to push the
[35:13] Stripe engineers to that next next
[35:15] level. Um, I made a prediction on this
[35:17] at the end of last year in our 2026 top
[35:20] 2% engineering video. I think in 2026
[35:23] we're going to see a blog post very
[35:25] similar to this where an engineer
[35:27] operating at serious scale, we're
[35:28] talking tens of millions in revenue. I
[35:30] predict we're going to see a blog post
[35:31] where they break down their agentic
[35:33] layer and talk about how they ship from
[35:35] prompt to production with ZTE zero touch
[35:38] engineering. So those are the only two
[35:40] notes I have. Again, you know, I'm not
[35:42] trying to
[35:44] Stripe has some of the most cracked
[35:45] engineers on the planet. This is just a
[35:47] note on the agentic system and not a
[35:49] note on any of their true core domain
[35:52] problem because again, if you operate a
[35:55] specific domain for years and years, no
[35:57] one knows how to solve it better than
[35:58] you do. All right, so those are my two
[36:00] notes. Big shout out to the Strap
[36:01] Engineering team and you know, Alistar
[36:04] Gray for writing this up. This is a
[36:05] great post. This really caught my eye
[36:07] and I thought it would be valuable to
[36:08] share with you here because it really
[36:10] emphasizes that point that building a
[36:12] powerful agentic layer really comes down
[36:15] to owning all the pieces bottom to top.
[36:18] Now there is a point in which you want
[36:20] to start owning your agentic technology,
[36:23] right? And again, if you're like
[36:25] creating a brand new net new product,
[36:27] you probably don't need to do that for a
[36:29] while. You just don't have the scale for
[36:31] it out of the box. It's going to work
[36:32] for you for a while. But then there's
[36:34] going to be a point where you're going
[36:35] to need a specific solution, right? A
[36:38] customized solution to solve a specific
[36:40] problem. And you want to boil that all
[36:43] the way down just like your application
[36:45] is a is a, you know, a detailed edge
[36:47] case covering solution. Your agent
[36:50] should reflect that too. That's why we
[36:52] covered the PI coding agent. There are
[36:54] many, but this one is mine. And the
[36:56] whole idea here that I want to, you
[36:58] know, connect with you on is that
[36:59] specialization goes all the way up the
[37:01] chain, all the way into the agent
[37:02] harness, all the way to your stack of
[37:05] technology that you operate. So anyway,
[37:07] big shout out to Stripe Engineers. This
[37:09] was really fun. I like blogs like this.
[37:11] You know, frankly, I'm getting a bit
[37:12] tired of everyone hyperfixating on
[37:15] models and prompts and skills. Like
[37:18] let's let's uplevel this and talk about
[37:20] the systems that have agents inside of
[37:23] them that contain agents and that
[37:25] contain code and that contain, you know,
[37:28] modern engineering technology that puts
[37:30] it all together to generate real value
[37:32] for you, your team, your company, and
[37:34] ultimately your users and customers,
[37:35] right? Because that's where the value
[37:37] really is. That's what makes all this
[37:39] stuff actually matter at all. All right?
[37:41] If you're still watching, first off, you
[37:42] know, big thanks to you. I hope these
[37:44] ideas make sense. You really want to be
[37:46] thinking about the agentic layer as a
[37:48] whole, not just your coding tool, not
[37:50] just the models. Let's let's ease up on
[37:52] the obsession on these, you know, models
[37:54] and who's winning and what genera
[37:57] company is more just let's focus on
[37:59] solving problems by building agentic
[38:01] layers with the key pieces. All right?
[38:03] And Stripe has outlined a lot of them,
[38:05] right? Like every agentic layer, every
[38:08] product is going to run into the
[38:09] problems that each one of these nodes is
[38:12] a solution to. So let's pay attention to
[38:14] them, right? Let's think about how these
[38:15] are pieces to the puzzle of building at
[38:18] scale with agents. All right? And this
[38:20] is just one interpretation. Uh no one
[38:22] has all the answers right now. But it's
[38:24] about collecting the right context to
[38:26] solving the problem of agentic
[38:28] engineering. Right? And and pushing what
[38:30] you can do further beyond before the
[38:33] industry before the mainstream catches
[38:35] up. All right. Everything we do in
[38:37] engineering represents an asymmetry of
[38:39] information and then technology and then
[38:42] results with your product, with your
[38:44] tool, with your team, so on and so
[38:45] forth. All right? So, you want to be
[38:47] pushing forward on this stuff. Don't let
[38:48] up the gas. Stay focused on valuable
[38:51] information like this blog and, you
[38:52] know, me being biased, but like this
[38:54] channel. I really try to focus in on
[38:57] concrete signal in the industry, not
[38:59] hype, not slop. There's going to be a
[39:01] lot of both of those as we move week
[39:03] after week. But I want this to be a
[39:05] place where you, the engineer, can come
[39:07] to focus and get some serious insight on
[39:09] how you can continue to win in the age
[39:11] of agents. If you made it to the end and
[39:13] you like this content, definitely feel
[39:15] free to check out tactical agentic
[39:17] coding. This is my take on how to scale
[39:19] far beyond AI coding and vibe coding
[39:21] with advanced agentic engineering so
[39:23] powerful your codebase runs itself. As
[39:26] you can imagine, a lot of the ideas
[39:28] detailed in this blog, detailed in the
[39:31] architecture of how Stripes built their
[39:33] agentic coding tool has been detailed in
[39:37] here. All right, I'll I'll be honest,
[39:38] I'm not like gloating or anything. I've
[39:40] been early to this. This is what happens
[39:42] when you're a first mover, when you bet
[39:43] big on an emerging technology.
[39:45] Everything you're going to see over the
[39:46] next year, I have in tactical Agenta
[39:48] coding and Agenta Horizon, the second
[39:50] part of this course detailed here. So,
[39:52] if you're interested, I'm going to leave
[39:54] a link to this. You can see all the
[39:56] ideas are really in stone here and
[39:58] thousands of engineers, some of your
[40:00] favorite engineers mind you, are inside
[40:02] of this course, have taken this course
[40:03] and have gotten massive value and are
[40:05] moving ahead of the curve. So, I'm going
[40:07] to leave this in here, link in the
[40:09] description for you. Of course, I'm also
[40:11] going to link the minions post.
[40:13] Definitely give this a look and I'll bet
[40:14] that if we search hiring. Yeah, so
[40:16] Stripe is hiring. If you're an agent
[40:18] that's interested in this, you can tell
[40:19] them that Andy Deb Dan sent you if you
[40:21] want. And again, just big shout out to
[40:23] the Stripe team. This is really great
[40:24] stuff. really great engineering in the
[40:26] age of agents. No matter what, stay
[40:28] focused and keep building.
